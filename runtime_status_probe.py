def test_documented_status_code_probe(direct_vm, direct_deploy):
    direct_vm.mock_web(r"example\.com", {"status": 200, "body": "probe"})
    contract = direct_deploy("probe_status_code_contract.py")
    contract.check("https://example.com/notice")
