#!/usr/bin/env python3
"""Вставка location карточки сервера в оба блока mcp.normaldance.ru (in-place)."""
import re

P = "/root/ndp/deploy/nginx.conf"
LOC = (
    "    # карточка сервера для сканеров маркетплейсов (Smithery server-card, 19.10.2026)\n"
    "    location = /.well-known/mcp/server-card.json {\n"
    "        default_type application/json;\n"
    "        alias /srv/www/mcp-server-card.json;\n"
    "    }\n\n"
)

s = open(P).read()
if "server-card.json" in s:
    print("уже вставлено")
else:
    s2 = re.sub(r"(server_name mcp\.normaldance\.ru;\n)", lambda m: m.group(1) + "\n" + LOC, s)
    n = s2.count("alias /srv/www/mcp-server-card.json")
    open(P, "w").write(s2)  # open(w) сохраняет inode: file-bind-mount увидит правку
    print("вставлено блоков:", n)
