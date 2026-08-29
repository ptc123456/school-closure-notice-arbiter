def test_probe_exercises_storage_web_and_serialization(direct_vm, direct_deploy):
    direct_vm.check_pickling = True
    direct_vm.mock_web(
        r"example\.com",
        {"status": 200, "body": "probe"},
    )

    contract = direct_deploy("probe_contract.py")

    assert contract.check("https://example.com/notice") == '{"status": 200, "value": "ok"}'
    assert contract.get_item("sample") == "ok"
