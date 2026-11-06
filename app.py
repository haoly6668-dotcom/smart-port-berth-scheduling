from flask import Flask, render_template, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

#内存数据存储
default_berths = [
    {"id": "T1", "maxDepth": 18.0, "totalQC": 15, "efficiency": 35, "length": 420},
    {"id": "T2", "maxDepth": 15.5, "totalQC": 10, "efficiency": 45, "length": 380},
    {"id": "T3", "maxDepth": 14.0, "totalQC": 12, "efficiency": 30, "length": 340},
    {"id": "T4", "maxDepth": 10.0, "totalQC": 6, "efficiency": 25, "length": 240}
]
current_berths = [b.copy() for b in default_berths]

default_ships = [
    {"id": 1, "name": "海丰·巨轮", "length": 335, "draft": 15.8, "teu": 8600, "arrivalTime": "06:20", "priority": "high"},
    {"id": 2, "name": "地中海荣耀", "length": 290, "draft": 14.2, "teu": 6800, "arrivalTime": "09:00", "priority": "mid"},
    {"id": 3, "name": "支线快航", "length": 145, "draft": 8.2, "teu": 1350, "arrivalTime": "10:30", "priority": "low"},
    {"id": 4, "name": "冷藏先锋", "length": 215, "draft": 11.5, "teu": 3000, "arrivalTime": "13:15", "priority": "high"},
    {"id": 5, "name": "泛亚商船", "length": 270, "draft": 13.8, "teu": 4800, "arrivalTime": "15:40", "priority": "mid"},
    {"id": 6, "name": "近海支线", "length": 120, "draft": 6.5, "teu": 800, "arrivalTime": "17:20", "priority": "low"}
]
ships = [s.copy() for s in default_ships]
next_ship_id = max([s["id"] for s in ships]) + 1 if ships else 1

#辅助函数
def time_to_minutes(time_str):
    h, m = map(int, time_str.split(':'))
    return h * 60 + m

def minutes_to_time(minutes):
    minutes = int(round(minutes))
    h = (minutes // 60) % 24
    m = minutes % 60
    return f"{h:02d}:{m:02d}"

def assign_qc(berth, teu):
    base = min(berth["totalQC"], max(2, (teu + 749) // 750))
    if berth["id"] == "T2" and teu > 2500:
        base = min(berth["totalQC"], base + 1)
    if berth["id"] == "T1" and teu > 6000:
        base = min(berth["totalQC"], base + 1)
    return base

def schedule_ships(berths, ships_list):
    berth_state = []
    for b in berths:
        berth_state.append({
            "id": b["id"], "maxDepth": b["maxDepth"], "totalQC": b["totalQC"],
            "efficiency": b["efficiency"], "length": b["length"],
            "idleTime": 0, "schedule": []
        })
    ships_to_schedule = []
    for s in ships_list:
        priority_val = 2.2 if s["priority"] == 'high' else (1.0 if s["priority"] == 'mid' else 0.65)
        ships_to_schedule.append({
            "id": s["id"], "name": s["name"], "length": s["length"],
            "draft": s["draft"], "teu": s["teu"], "arrivalTime": s["arrivalTime"],
            "arrivalMin": time_to_minutes(s["arrivalTime"]), "priority": s["priority"],
            "priorityVal": priority_val
        })
    ships_to_schedule.sort(key=lambda x: (-x["priorityVal"], x["arrivalMin"]))
    results = []
    for ship in ships_to_schedule:
        best = {"idx": -1, "start": 0, "end": 0, "qc": 0, "cost": float('inf'), "eff": 0, "berthId": ""}
        for i, b in enumerate(berth_state):
            if ship["draft"] + 1.0 >= b["maxDepth"]:
                continue
            if ship["length"] > b["length"]:
                continue
            qc_num = assign_qc(b, ship["teu"])
            if qc_num <= 0:
                continue
            work_hours = ship["teu"] / (qc_num * b["efficiency"])
            work_mins = work_hours * 60
            assist_mins = 32
            possible_start = max(ship["arrivalMin"], b["idleTime"])
            finish = possible_start + work_mins + assist_mins
            cost = (possible_start - ship["arrivalMin"]) + work_mins
            if ship["priority"] == 'high' and b["id"] == 'T2':
                cost *= 0.88
            if ship["teu"] > 5500 and b["id"] == 'T1':
                cost *= 0.86
            if ship["priority"] == 'low' and (b["id"] == 'T1' or b["id"] == 'T2'):
                cost *= 1.2
            if cost < best["cost"]:
                best = {"idx": i, "start": possible_start, "end": finish, "qc": qc_num,
                        "cost": cost, "eff": b["efficiency"], "berthId": b["id"]}
        if best["idx"] == -1:
            reason = ""
            for b in berth_state:
                if ship["draft"] + 1.0 >= b["maxDepth"]:
                    reason = f"吃水过大（需要 ≤ {b['maxDepth']-1:.1f}m）"
                    break
                if ship["length"] > b["length"]:
                    reason = f"船身过长（需要 ≤ {b['length']}m）"
                    break
            if not reason:
                reason = "无可用泊位"
            results.append({"shipId": ship["id"], "shipName": ship["name"], "teu": ship["teu"],
                            "error": True, "msg": reason})
            continue
        target = berth_state[best["idx"]]
        target["idleTime"] = best["end"]
        record = {
            "shipId": ship["id"], "shipName": ship["name"], "teu": ship["teu"],
            "berthId": target["id"],
            "startMin": int(round(best["start"])),
            "endMin": int(round(best["end"])),
            "startTimeStr": minutes_to_time(best["start"]),
            "endTimeStr": minutes_to_time(best["end"]),
            "allocatedQC": best["qc"],
            "efficiency": best["eff"],
            "arrivalMin": ship["arrivalMin"]
        }
        target["schedule"].append(record)
        results.append(record)
    return {"assignments": results, "berthState": berth_state}

#API 路由
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/berths', methods=['GET'])
def get_berths():
    return jsonify(current_berths)

@app.route('/api/berths', methods=['PUT'])
def update_berths():
    global current_berths
    data = request.get_json()
    if not isinstance(data, list):
        return jsonify({"error": "数据格式错误"}), 400
    for item in data:
        if not all(k in item for k in ("id", "maxDepth", "totalQC", "efficiency", "length")):
            return jsonify({"error": "缺少字段"}), 400
    current_berths = data
    return jsonify({"message": "泊位配置已更新"})

@app.route('/api/berths/reset', methods=['POST'])
def reset_berths():
    global current_berths
    current_berths = [b.copy() for b in default_berths]
    return jsonify({"message": "泊位已重置为默认配置"})

@app.route('/api/ships', methods=['GET'])
def get_ships():
    return jsonify(ships)

@app.route('/api/ships', methods=['POST'])
def add_ship():
    global next_ship_id
    data = request.get_json()
    required = ['name', 'length', 'draft', 'teu', 'arrivalTime', 'priority']
    if not all(k in data for k in required):
        return jsonify({"error": "缺少必要字段"}), 400
    new_ship = {
        "id": next_ship_id,
        "name": data['name'],
        "length": float(data['length']),
        "draft": float(data['draft']),
        "teu": int(data['teu']),
        "arrivalTime": data['arrivalTime'],
        "priority": data['priority']
    }
    ships.append(new_ship)
    next_ship_id += 1
    return jsonify({"id": new_ship["id"], "message": "船舶已添加"})

@app.route('/api/ships/<int:ship_id>', methods=['DELETE'])
def delete_ship(ship_id):
    global ships
    ships = [s for s in ships if s["id"] != ship_id]
    return jsonify({"message": "船舶已删除"})

@app.route('/api/schedule', methods=['POST'])
def run_schedule():
    if not ships:
        return jsonify({"error": "没有船舶数据，请先添加船舶"}), 400
    result = schedule_ships(current_berths, ships)
    return jsonify(result)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)