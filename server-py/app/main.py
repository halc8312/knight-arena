"""MechArena shared-world server: WebSocket rooms, authoritative positions, 15Hz snapshots."""
import asyncio
import json
import math
import random

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

TICK_MS = 1000 / 15
SPEED = 6.0
BOUND = 48

app = FastAPI()
players = {}  # id -> dict(ws, x, z, rotY, dx, dz, name, color)
next_id = 1


async def broadcast(msg, except_id=None):
    s = json.dumps(msg)
    for pid, p in list(players.items()):
        if pid != except_id:
            try:
                await p["ws"].send_text(s)
            except Exception:
                pass


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    global next_id
    await ws.accept()
    pid = next_id
    next_id += 1
    p = {
        "ws": ws,
        "x": (random.random() - 0.5) * 20,
        "z": (random.random() - 0.5) * 20,
        "rotY": 0.0, "dx": 0.0, "dz": 0.0,
        "name": f"Mech-{pid}", "color": random.randrange(0xFFFFFF),
    }
    players[pid] = p
    await ws.send_text(json.dumps({
        "type": "welcome", "id": pid,
        "players": [{"id": qid, "x": q["x"], "z": q["z"], "rotY": q["rotY"],
                     "name": q["name"], "color": q["color"]}
                    for qid, q in players.items()],
    }))
    await broadcast({"type": "join", "id": pid, "x": p["x"], "z": p["z"],
                     "rotY": 0, "name": p["name"], "color": p["color"]}, pid)
    print(f"join {pid} ({len(players)} online)")
    try:
        while True:
            m = json.loads(await ws.receive_text())
            if m.get("type") == "input":
                dx, dz = float(m.get("dx") or 0), float(m.get("dz") or 0)
                length = math.hypot(dx, dz)
                k = 1 / length if length > 1 else 1
                p["dx"], p["dz"] = dx * k, dz * k
                if isinstance(m.get("rotY"), (int, float)) and length > 0.1:
                    p["rotY"] = float(m["rotY"])
                if m.get("name") and isinstance(m["name"], str) and m["name"].strip():
                    p["name"] = m["name"].strip()[:16]
            elif m.get("type") == "chat" and isinstance(m.get("text"), str):
                await broadcast({"type": "chat", "id": pid, "text": m["text"][:120]})
    except WebSocketDisconnect:
        pass
    finally:
        players.pop(pid, None)
        await broadcast({"type": "leave", "id": pid})
        print(f"leave {pid} ({len(players)} online)")


@app.on_event("startup")
async def ticker():
    async def loop():
        dt = TICK_MS / 1000
        while True:
            for p in players.values():
                p["x"] = max(-BOUND, min(BOUND, p["x"] + p["dx"] * SPEED * dt))
                p["z"] = max(-BOUND, min(BOUND, p["z"] + p["dz"] * SPEED * dt))
            if players:
                await broadcast({
                    "type": "state",
                    "players": [[pid, round(p["x"], 3), round(p["z"], 3),
                                 round(p["rotY"], 3), p["name"], p["color"]]
                                for pid, p in players.items()],
                })
            await asyncio.sleep(dt)
    asyncio.create_task(loop())


@app.get("/health")
def health():
    return {"ok": True, "players": len(players)}


if __name__ == "__main__":
    import os
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
