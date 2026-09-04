import json

with open('api/database.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
    usuarios = data.get('usuarios_db', {})
    print(f"Users in backup: {len(usuarios)}")
    if 'admin@kapital.com' in usuarios:
        print("Admin is in backup!")
    if '74538840' in usuarios:
        print("Conductor 74538840 is in backup!")
