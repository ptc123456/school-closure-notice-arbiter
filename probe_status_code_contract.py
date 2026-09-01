# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *


class ProbeStatusCode(gl.Contract):
    def __init__(self):
        pass

    @gl.public.write
    def check(self, url: str) -> int:
        def leader_fn():
            return gl.nondet.web.get(url).status_code

        def validator_fn(leader_result):
            return isinstance(leader_result, gl.vm.Return) and leader_fn() == leader_result.calldata

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
