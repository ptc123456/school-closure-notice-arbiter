import ast
import json
from pathlib import Path

import pytest


CONTRACT = "contracts/school_closure_notice_arbiter.py"
URL_A = "https://notices.test/a"
URL_B = "https://notices.test/b"


def test_response_status_supports_documented_and_cached_runner_shapes():
    source = Path(CONTRACT).read_text(encoding="utf-8")
    tree = ast.parse(source, filename=CONTRACT)
    helper = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "_response_status"
    )
    namespace = {}
    exec(compile(ast.Module(body=[helper], type_ignores=[]), CONTRACT, "exec"), namespace)
    response_status = namespace["_response_status"]

    class DocumentedResponse:
        status_code = 200

    class CachedRunnerResponse:
        status = 201

    class InvalidResponse:
        pass

    assert response_status(DocumentedResponse()) == 200
    assert response_status(CachedRunnerResponse()) == 201
    assert response_status(InvalidResponse()) == -1


def notice(
    *,
    school_id="school-7",
    notice_id="notice-a",
    closure_date="2026-09-01",
    reopen_date="2026-09-08",
    unknown_duration=False,
    revision_kind="ORDINAL",
    revision_value="1",
):
    return {
        "school_id": school_id,
        "notice_id": notice_id,
        "closure_date": closure_date,
        "reopen_date": reopen_date,
        "unknown_duration": unknown_duration,
        "revision_kind": revision_kind,
        "revision_value": revision_value,
    }


def install_notice_mocks(direct_vm, notice_a, notice_b=None, *, status=200):
    direct_vm.strict_mocks = True
    direct_vm.mock_web(r"notices\.test/a$", {"status": status, "body": "NOTICE_A"})
    direct_vm.mock_web(r"notices\.test/b$", {"status": status, "body": "NOTICE_B"})
    if status == 200:
        direct_vm.mock_llm(r"NOTICE_A", json.dumps(notice_a))
        direct_vm.mock_llm(r"NOTICE_B", json.dumps(notice_b or notice_a))


def deploy_case(direct_vm, direct_deploy, *, case_id="case-1", school_id="school-7"):
    direct_vm.check_pickling = True
    contract = direct_deploy(CONTRACT)
    contract.create_case(case_id, school_id, URL_A, URL_B)
    contract.freeze_case(case_id)
    return contract


def test_create_freeze_and_match_with_canonical_readback(direct_vm, direct_deploy):
    data = notice()
    install_notice_mocks(direct_vm, data)
    contract = deploy_case(direct_vm, direct_deploy)

    assert contract.assess("case-1") == "ASSESSED:MATCH"
    case = contract.get_case("case-1")
    assert case["state"] == "ASSESSED"
    assert case["outcome"] == "MATCH"
    assert case["closure_date"] == "2026-09-01"
    assert case["reopen_date"] == "2026-09-08"
    assert case["notice_revision_a"] == "ORDINAL:1"
    assert len(case["evidence_digest"]) == 64


@pytest.mark.parametrize(
    ("data_a", "data_b", "expected"),
    [
        (notice(), notice(closure_date="2026-09-02"), "CONFLICTING_DATES"),
        (notice(), notice(revision_value="2"), "ONE_SOURCE_OLDER"),
        (notice(), notice(revision_kind="EFFECTIVE_DATE", revision_value="2026-08-31"), "UNRESOLVED"),
        (notice(), notice(revision_value=""), "UNRESOLVED"),
        (notice(school_id=""), notice(), "UNRESOLVED"),
        (notice(notice_id=""), notice(), "UNRESOLVED"),
        (notice(revision_kind="BAD_KIND"), notice(), "UNRESOLVED"),
        (notice(), notice(school_id=""), "UNRESOLVED"),
        (notice(), notice(notice_id=""), "UNRESOLVED"),
        (notice(revision_value=""), notice(revision_value=""), "UNRESOLVED"),
        (notice(), notice(school_id="school-other"), "UNRESOLVED"),
        (notice(), notice(closure_date=""), "INSUFFICIENT_NOTICE"),
        (notice(), notice(reopen_date="", unknown_duration=False), "INSUFFICIENT_NOTICE"),
        (notice(reopen_date="", unknown_duration=True), notice(reopen_date="", unknown_duration=True), "MATCH"),
    ],
)
def test_outcome_table(direct_vm, direct_deploy, data_a, data_b, expected):
    install_notice_mocks(direct_vm, data_a, data_b)
    contract = deploy_case(direct_vm, direct_deploy)

    expected_state = "RETRYABLE" if expected == "UNRESOLVED" else "ASSESSED"
    assert contract.assess("case-1") == f"{expected_state}:{expected}"
    assert contract.get_case_state("case-1") == expected_state


@pytest.mark.parametrize("status", [0, 429, 410, 500, 503])
def test_transport_failure_is_unresolved_and_bounded_retryable(direct_vm, direct_deploy, status):
    install_notice_mocks(direct_vm, notice(), status=status)
    contract = deploy_case(direct_vm, direct_deploy)

    assert contract.assess("case-1") == "RETRYABLE:UNRESOLVED"
    assert contract.get_case("case-1")["retry_count"] == "0"


def test_missing_notice_is_unresolved(direct_vm, direct_deploy):
    install_notice_mocks(direct_vm, notice(), status=404)
    contract = deploy_case(direct_vm, direct_deploy)

    assert contract.assess("case-1") == "RETRYABLE:UNRESOLVED"


def test_reordered_sources_and_conflicting_http_timestamps_do_not_change_match(
    direct_vm, direct_deploy
):
    data = notice()
    direct_vm.strict_mocks = True
    direct_vm.mock_web(
        r"notices\.test/a$",
        {
            "method": "GET",
            "response": {
                "status": 200,
                "headers": {"Date": b"2099-01-01", "Last-Modified": b"2099-01-02"},
                "body": b"NOTICE_A",
            },
        },
    )
    direct_vm.mock_web(
        r"notices\.test/b$",
        {
            "method": "GET",
            "response": {
                "status": 200,
                "headers": {"Date": b"2000-01-01", "Last-Modified": b"2000-01-02"},
                "body": b"NOTICE_B",
            },
        },
    )
    direct_vm.mock_llm(r"NOTICE_A", json.dumps(data))
    direct_vm.mock_llm(r"NOTICE_B", json.dumps(data))

    contract = direct_deploy(CONTRACT)
    contract.create_case("case-1", "school-7", URL_B, URL_A)
    contract.freeze_case("case-1")

    assert contract.assess("case-1") == "ASSESSED:MATCH"


def test_invalid_url_duplicate_and_wrong_state_revert(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    with direct_vm.expect_revert("two distinct HTTPS notice URLs are required"):
        contract.create_case("bad", "school-7", "http://notices.test/a", URL_B)
    with direct_vm.expect_revert("two distinct HTTPS notice URLs are required"):
        contract.create_case("bad-2", "school-7", URL_A, URL_A)

    contract.create_case("case-1", "school-7", URL_A, URL_B)
    with direct_vm.expect_revert("case must be FROZEN before assessment"):
        contract.assess("case-1")


def test_validator_disagreement_is_visible_to_direct_mode(direct_vm, direct_deploy):
    data_a = notice()
    data_b = notice(closure_date="2026-09-02")
    install_notice_mocks(direct_vm, data_a, data_a)
    contract = deploy_case(direct_vm, direct_deploy)
    contract.assess("case-1")

    direct_vm.clear_mocks()
    direct_vm.mock_web(r"notices\.test/a$", {"status": 200, "body": "NOTICE_A"})
    direct_vm.mock_web(r"notices\.test/b$", {"status": 200, "body": "NOTICE_B"})
    direct_vm.mock_llm(r"NOTICE_A", json.dumps(data_a))
    direct_vm.mock_llm(r"NOTICE_B", json.dumps(data_b))
    assert direct_vm.run_validator() is False


def test_retry_stops_after_three_unresolved_attempts(direct_vm, direct_deploy):
    install_notice_mocks(direct_vm, notice(), status=429)
    contract = deploy_case(direct_vm, direct_deploy)

    assert contract.assess("case-1") == "RETRYABLE:UNRESOLVED"
    assert contract.retry_unresolved("case-1") == "RETRYABLE:UNRESOLVED"
    assert contract.retry_unresolved("case-1") == "RETRYABLE:UNRESOLVED"
    assert contract.retry_unresolved("case-1") == "ASSESSED:UNRESOLVED"
    with direct_vm.expect_revert("case is not retryable"):
        contract.retry_unresolved("case-1")
