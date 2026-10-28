from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request


def client_ip(request: Request) -> str:
    # Behind Cloudflare + Coolify proxy the socket peer is the proxy, not the client
    return request.headers.get("cf-connecting-ip") or get_remote_address(request)


limiter = Limiter(key_func=client_ip)
