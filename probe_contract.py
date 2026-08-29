# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from dataclasses import dataclass
import json

from genlayer import *


@allow_storage
@dataclass
class ProbeItem:
    value: str


class Probe(gl.Contract):
    items: TreeMap[str, ProbeItem]

    def __init__(self):
        pass

    @gl.public.write
    def check(self, url: str) -> str:
        self.items["sample"] = ProbeItem("ok")
        copied = gl.storage.copy_to_memory(self.items["sample"])

        def leader_fn():
            response = gl.nondet.web.get(url)
            return json.dumps({"status": response.status, "value": copied.value}, sort_keys=True)

        def validator_fn(leader_result):
            if not isinstance(leader_result, gl.vm.Return):
                return False
            return leader_fn() == leader_result.calldata

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    @gl.public.view
    def get_item(self, key: str) -> str:
        return self.items[key].value
