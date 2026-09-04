import json
import asyncio
import httpx
from index import SUPABASE_URL, HEADERS

async def update_sims():
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.get(f'{SUPABASE_URL}/app_state?id=eq.1', headers=HEADERS)
        data = res.json()[0]['usuarios']
        
        # Remove old sim drivers
        keys_to_remove = [k for k in data.keys() if k.startswith('sim') and k.endswith('@kapital.com')]
        for k in keys_to_remove:
            del data[k]
            
        flota = data.get('__flota__', {})
        # Remove old vehicles
        if isinstance(flota, dict):
            flota_keys_to_remove = [k for k in flota.keys() if k.startswith('AK-') or k.startswith('K-') or k.startswith('KV-')]
            for k in flota_keys_to_remove:
                del flota[k]
                
        # Define new vehicles
        k_list = ['K-027','K-142','K-163','K-170','K-193','K-194','K-207','K-210','K-215','K-218','K-222','K-223','K-232','K-235','K-237','K-240','K-244','K-246','K-247']
        kv_list = ['KV-013','KV-023','KV-026','KV-073','KV-076','KV-079','KV-093','KV-098','KV-114','KV-131','KV-141','KV-142','KV-143','KV-145','KV-154','KV-158','KV-160','KV-162','KV-167','KV-169','KV-170','KV-172','KV-174','KV-175','KV-177','KV-178','KV-180','KV-187','KV-193','KV-194','KV-200','KV-201','KV-204','KV-208','KV-210','KV-211','KV-212','KV-214','KV-215','KV-218','KV-219','KV-221','KV-222','KV-224','KV-227','KV-228','KV-229']

        all_plates = k_list + kv_list
        for i, placa in enumerate(all_plates, 1):
            is_k = placa in k_list
            capacidad = 4 if is_k else 15
            tipo = 'Auto' if is_k else 'Van'
            
            dni = f'74000{i:03d}'
            nombre = f'Conductor Sim {placa}'
            email = f'sim_{placa.lower()}@kapital.com'
            
            data[email] = {
                'identifier': email,
                'email': email,
                'dni': dni,
                'password': '123',
                'nombre': nombre,
                'rol': 'Conductor',
                'estado': 'Activo',
                'perfil_conductor': {
                    'placa': placa
                }
            }
            
            flota[placa] = {
                'id': placa,
                'placa': placa,
                'conductor': email,
                'chofer': nombre,
                'tipo': tipo,
                'capacidad': capacidad,
                'soat': '2026-12-31',
                'rt': '2026-12-31',
                'tuc': '2026-12-31',
                'licencia': '2026-12-31'
            }
            
        data['__flota__'] = flota
        payload = {'usuarios': data}
        res2 = await client.patch(f'{SUPABASE_URL}/app_state?id=eq.1', headers=HEADERS, json=payload)
        print('Updated:', res2.status_code, 'Total vehicles added:', len(all_plates))
        
asyncio.run(update_sims())
