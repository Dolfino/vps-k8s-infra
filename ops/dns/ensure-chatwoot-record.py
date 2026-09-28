#!/usr/bin/env python3
"""Check or create the Chatwoot DNS record in Cloudflare.

Requires CLOUDFLARE_API_TOKEN with Zone Read and DNS Write for ideiasmkt.com.br.
The default mode only reports the change. Pass --apply to create/update it.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

ZONE = "ideiasmkt.com.br"
HOST = "chatwoot.ideiasmkt.com.br"
TARGET = "manager01.ideiasmkt.com.br"
BASE = "https://api.cloudflare.com/client/v4"


def api(method, path, token, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        payload = json.load(response)
    if not payload.get("success"):
        raise RuntimeError(f"Cloudflare API rejected {method} {path}: {payload.get('errors')}")
    return payload["result"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the DNS record")
    args = parser.parse_args()
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token:
        raise RuntimeError("Set CLOUDFLARE_API_TOKEN before running this script")

    zones = api("GET", "/zones?" + urllib.parse.urlencode({"name": ZONE}), token)
    if len(zones) != 1:
        raise RuntimeError(f"Expected one Cloudflare zone named {ZONE}; found {len(zones)}")
    zone_id = zones[0]["id"]
    records = api(
        "GET",
        f"/zones/{zone_id}/dns_records?" + urllib.parse.urlencode({"name": HOST}),
        token,
    )
    if len(records) > 1 or (records and records[0]["type"] != "CNAME"):
        raise RuntimeError(f"{HOST} has conflicting DNS records; review them manually")

    desired = {"type": "CNAME", "name": HOST, "content": TARGET, "ttl": 1, "proxied": False}
    if records and all(records[0].get(k) == desired[k] for k in ("type", "name", "proxied")) and records[0].get("content", "").rstrip(".") == TARGET:
        print(f"OK: {HOST} points to {TARGET} with proxy disabled")
        return

    action = "update" if records else "create"
    if not args.apply:
        print(f"Would {action} CNAME {HOST} -> {TARGET} (DNS only). Re-run with --apply.")
        return

    if records:
        api("PATCH", f"/zones/{zone_id}/dns_records/{records[0]['id']}", token, desired)
    else:
        api("POST", f"/zones/{zone_id}/dns_records", token, desired)
    print(f"Configured CNAME {HOST} -> {TARGET} (DNS only)")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        sys.exit(1)
