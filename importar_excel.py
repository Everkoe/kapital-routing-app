import pandas as pd
import requests
import os
import re
import unicodedata
import glob
import random

# Configuración de Supabase
SUPABASE_URL = "https://pkyezkdssyrbwxhldsay.supabase.co/rest/v1"
SUPABASE_KEY = "sb_publishable_EAqFBKHuDkoN7WqxeoGcMA_Iv0qEM0o"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

def remove_accents(input_str):
    nfkd_form = unicodedata.normalize('NFKD', str(input_str))
    return u"".join([c for c in nfkd_form if not unicodedata.combining(c)])

def clean_email(name):
    clean = remove_accents(name).lower()
    clean = re.sub(r'[^a-z0-9 ]', '', clean)
    parts = clean.split()
    if len(parts) >= 2:
        return f"{parts[0]}.{parts[1]}@kapital.com"
    elif len(parts) == 1:
        return f"{parts[0]}@kapital.com"
    return "conductor@kapital.com"

def format_dni(dni):
    dni_str = str(dni).strip()
    if dni_str.endswith('.0'):
        dni_str = dni_str[:-2]
    return dni_str

def main():
    # Buscar todos los archivos Excel en la carpeta actual
    excel_files = glob.glob("*.xlsx")
    if not excel_files:
        print("ERROR: No se encontraron archivos .xlsx en la carpeta actual.")
        return

    print("Conectando con Supabase...")
    res = requests.get(f"{SUPABASE_URL}/app_state?id=eq.1", headers=HEADERS)
    if res.status_code != 200 or len(res.json()) == 0:
        print("ERROR: No se pudo conectar con Supabase.")
        return
    
    app_state = res.json()[0]
    usuarios_db = app_state.get("usuarios", {})
    
    # Asegurarnos de que exista el objeto de la flota
    if "__flota__" not in usuarios_db:
        usuarios_db["__flota__"] = {}
        
    flota = usuarios_db["__flota__"]
    
    nuevos_accesos = []

    for excel_path in excel_files:
        if excel_path.startswith("~$"): continue # Ignorar temporales de Excel
        print(f"\n--- Procesando archivo: {excel_path} ---")
        
        try:
            xls = pd.ExcelFile(excel_path)
        except Exception as e:
            print(f"Error al abrir {excel_path}: {e}")
            continue
            
        for sheet_name in xls.sheet_names:
            print(f"  -> Leyendo hoja: {sheet_name}")
            
            # Asumimos que la fila 0 es la cabecera en el nuevo Excel maestro
            df = None
            try:
                df = pd.read_excel(excel_path, sheet_name=sheet_name, dtype=str)
            except Exception as e:
                print(f"Error al leer hoja: {e}")
                continue
                
            if df is None or df.empty:
                print(f"     Hoja vacía. Saltando...")
                continue
                
            # Limpiar nombres de columnas para facilitar la búsqueda
            def normalize_col(c):
                import unicodedata
                return unicodedata.normalize('NFKD', str(c)).encode('ascii', 'ignore').decode('utf-8').strip().upper()

            cols = {normalize_col(c): c for c in df.columns}
            
            # Nombres de las columnas sin acentos (gracias a normalize_col)
            col_base = cols.get("BASE")
            col_nombre = cols.get("NOMBRES Y APELLIDOS")
            col_direccion = cols.get("DIRECCION")
            col_dni = cols.get("DNI")
            col_fecha_nac = cols.get("FECHA DE NACIMIENTO") or cols.get("FECHA DE NAC")
            col_celular = cols.get("CELULAR")
            col_padron = cols.get("PADRON")
            col_placa = cols.get("PLACA")
            col_tipo = cols.get("TIPO DE VEHICULO")
            col_capacidad = cols.get("CAPACIDAD")
            col_marca = cols.get("MARCA")
            col_modelo = cols.get("MODELO")
            col_ano = cols.get("ANO")
            col_color = cols.get("COLOR")
            col_grupo = cols.get("GRUPO")

            if not col_nombre or not col_dni or not col_padron:
                print(f"     Faltan columnas clave (NOMBRES Y APELLIDOS, DNI o PADRON). Revisa el Excel.")
                continue

            count = 0
            for index, row in df.iterrows():
                nombre = str(row[col_nombre]).strip()
                dni = format_dni(row[col_dni])
                if not nombre or nombre == 'nan' or not dni or dni == 'nan':
                    continue
                    
                padron = str(row[col_padron]).strip()
                if not padron or padron == 'nan': 
                    continue
                    
                base = str(row[col_base]).strip() if col_base else ""
                if base == 'nan': base = ""
                
                direccion = str(row[col_direccion]).strip() if col_direccion else ""
                if direccion == 'nan': direccion = ""
                
                fecha_nac = str(row[col_fecha_nac]).strip() if col_fecha_nac else ""
                if fecha_nac == 'nan': fecha_nac = ""
                # Formatear fecha para evitar los "00:00:00"
                if fecha_nac and " " in fecha_nac:
                    fecha_nac = fecha_nac.split(" ")[0]
                
                celular = str(row[col_celular]).strip() if col_celular else ""
                if celular == 'nan' or celular.endswith('.0'): 
                    celular = celular.replace('.0', '')
                
                placa = str(row[col_placa]).strip() if col_placa else ""
                if placa == 'nan': placa = ""
                
                tipo = str(row[col_tipo]).strip() if col_tipo else "Van"
                if tipo == 'nan': tipo = "Van"
                
                capacidad_str = str(row[col_capacidad]).strip() if col_capacidad else "10"
                if capacidad_str == 'nan' or capacidad_str.endswith('.0'): 
                    capacidad_str = capacidad_str.replace('.0', '')
                capacidad = int(capacidad_str) if capacidad_str.isdigit() else 10
                
                marca = str(row[col_marca]).strip() if col_marca else ""
                if marca == 'nan': marca = ""
                
                modelo = str(row[col_modelo]).strip() if col_modelo else ""
                if modelo == 'nan': modelo = ""
                
                ano = str(row[col_ano]).strip() if col_ano else ""
                if ano == 'nan' or ano.endswith('.0'): 
                    ano = ano.replace('.0', '')
                
                color = str(row[col_color]).strip() if col_color else ""
                if color == 'nan': color = ""
                
                correo = clean_email(nombre)
                password = f"kap{random.randint(1000, 9999)}"
                email_key = correo.lower()
                
                # 1. Crear en usuarios_db
                usuarios_db[email_key] = {
                    "email": email_key,
                    "password": password,
                    "nombre": nombre,
                    "rol": "Conductor",
                    "celular": celular,
                    "estado": "Activo",
                    "unidad_id": padron,
                    "needs_password_change": True,
                    "perfil_conductor": {
                        "tipoDoc": "DNI",
                        "numDoc": dni,
                        "fechaNacimiento": fecha_nac,
                        "direccion": direccion,
                        "telefonoDirecto": celular,
                        "placa": placa,
                        "capacidadVehiculo": str(capacidad),
                        "vehiculoTipo": tipo,
                        "vehiculoMarca": marca,
                        "vehiculoModelo": modelo,
                        "vehiculoAnio": ano,
                        "vehiculoColor": color
                    }
                }
                
                # 2. Actualizar/Crear en flota_db (usando padron como llave)
                # NOTA: si la placa ya existe con otro padron, esto asume que en el nuevo Excel no hay duplicados.
                flota[padron] = {
                    "unidad_id": padron,
                    "placa": placa,
                    "base": base,
                    "chofer": nombre,
                    "tipo": tipo,
                    "capacidad": capacidad,
                    "marca": marca,
                    "modelo": modelo,
                    "ano": ano,
                    "color": color,
                    # Dejamos estos campos vacíos para llenado manual posterior
                    "soat": "", "revision": "", "atu": "", "licencia": "",
                    "soat_doc": "", "revision_doc": "", "atu_doc": "", "licencia_doc": ""
                }
                
                nuevos_accesos.append({
                    "Padrón": padron,
                    "Base": base,
                    "Nombre": nombre,
                    "DNI": dni,
                    "Correo (Usuario)": email_key,
                    "Contraseña": password
                })
                count += 1
                
            print(f"     => Procesados {count} conductores/vehículos.")

    if not nuevos_accesos:
        print("No se encontraron registros válidos para importar.")
        return

    print(f"\nSe van a insertar/actualizar {len(nuevos_accesos)} registros. Actualizando Supabase...")
    
    # Parchear el app_state (se envía el diccionario usuarios completo, que ahora contiene la flota limpia y actualizada)
    payload = {
        "usuarios": usuarios_db
    }
    
    update_res = requests.patch(
        f"{SUPABASE_URL}/app_state?id=eq.1", 
        headers=HEADERS, 
        json=payload
    )
    
    if update_res.status_code in [200, 204]:
        print("¡ÉXITO! Base de datos actualizada correctamente.")
        df_accesos = pd.DataFrame(nuevos_accesos)
        df_accesos.to_csv("accesos_generados_multiples.csv", index=False, encoding='utf-8-sig')
        print("Se ha generado el archivo 'accesos_generados_multiples.csv' con todas las credenciales.")
    else:
        print(f"ERROR al actualizar Supabase: {update_res.text}")

if __name__ == "__main__":
    main()
