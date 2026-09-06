import pandas as pd
import requests
import os
import re
import unicodedata
import glob

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

def find_column(df_columns, possible_names):
    for col in df_columns:
        clean_col = str(col).strip().upper()
        for name in possible_names:
            if name in clean_col:
                return col
    return None

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
    flota = app_state.get("flota", {})
    
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
            # Ignorar hojas de bajas/cesados
            if "BAJA" in sheet_name.upper() or "CESADO" in sheet_name.upper() or "INACTIVO" in sheet_name.upper():
                print(f"  -> Ignorando hoja (bajas): {sheet_name}")
                continue
                
            print(f"  -> Leyendo hoja: {sheet_name}")
            
            # Buscar fila de cabeceras (a veces es 0, a veces 1 o 2)
            df = None
            for r in range(5):
                temp_df = pd.read_excel(excel_path, sheet_name=sheet_name, header=r)
                cols = [str(c).upper() for c in temp_df.columns]
                # Criterio: Debe tener una columna que parezca ser de DNI o Trabajador
                if any("DNI" in c for c in cols) or any("TRABAJADOR" in c for c in cols) or any("APELLIDOS" in c for c in cols):
                    df = temp_df
                    break
                    
            if df is None or df.empty:
                print(f"     No se encontraron cabeceras válidas. Saltando...")
                continue
                
            # Mapeo inteligente de columnas
            col_name = find_column(df.columns, ["APELLIDOS Y NOMBRES", "TRABAJADOR", "NOMBRE"])
            col_dni = find_column(df.columns, ["DNI / CE", "DNI/CE", "DNI", "DOCUMENTO"])
            col_padron = find_column(df.columns, ["PADRON", "PADRÓN"])
            col_placa = find_column(df.columns, ["PLACA", "PLACA "])
            col_correo = find_column(df.columns, ["CORREO ELECTRONICO", "CORREO", "EMAIL"])
            col_celular = find_column(df.columns, ["CELULAR", "TELEFONO", "MOVIL"])
            col_estatus = find_column(df.columns, ["ESTATUS", "ESTADO", "ESTATUT"])

            if not col_name or not col_dni:
                print(f"     Faltan columnas clave (Nombre o DNI). Saltando...")
                continue

            for index, row in df.iterrows():
                # Filtro de Estatus (si existe la columna)
                if col_estatus:
                    estatus = str(row[col_estatus]).strip().upper()
                    if "ACTIVO" not in estatus and "ALTA" not in estatus and estatus not in ["NAN", ""]:
                        # Si la hoja en sí misma se llama ALTA o ACTIVOS, perdonamos el estatus
                        if sheet_name.upper() not in ["ALTA", "ALTAS", "ACTIVOS"]:
                            continue
                    
                nombre = str(row[col_name]).strip()
                dni = str(row[col_dni]).strip()
                if not nombre or nombre == 'nan' or not dni or dni == 'nan':
                    continue
                    
                padron = str(row[col_padron]).strip() if col_padron else f"EXT-{dni[-4:]}" 
                if padron == 'nan' or not padron: padron = f"EXT-{dni[-4:]}"
                    
                placa = str(row[col_placa]).strip() if col_placa else ""
                if placa == 'nan': placa = ""
                    
                correo = str(row[col_correo]).strip() if col_correo else ""
                if correo == 'nan' or not correo:
                    correo = clean_email(nombre)
                    
                celular = str(row[col_celular]).strip() if col_celular else ""
                if celular == 'nan': celular = ""
                    
                password = dni
                email_key = correo.lower()
                
                # Crear en usuarios_db
                usuarios_db[email_key] = {
                    "email": email_key,
                    "password": password,
                    "nombre": nombre,
                    "rol": "Conductor",
                    "celular": celular,
                    "estado": "Activo",
                    "unidad_id": padron,
                    "perfil_conductor": {
                        "numDoc": dni,
                        "vehiculoPlaca": placa
                    }
                }
                
                # Crear en flota
                if padron not in flota:
                    flota[padron] = {
                        "capacidad": 15,
                        "tipo": "Van",
                        "chofer": nombre,
                        "placa": placa
                    }
                    
                nuevos_accesos.append({
                    "Archivo Origen": excel_path,
                    "Hoja": sheet_name,
                    "Nombre": nombre,
                    "Padrón": padron,
                    "Placa": placa,
                    "Correo (Usuario)": email_key,
                    "Contraseña": password
                })
                
    print(f"\n=========================================")
    print(f"Total de conductores procesados: {len(nuevos_accesos)}")
    
    if len(nuevos_accesos) > 0:
        print("Sincronizando con la nube (Supabase)...")
        app_state["usuarios"] = usuarios_db
        app_state["flota"] = flota
        
        update_res = requests.patch(
            f"{SUPABASE_URL}/app_state?id=eq.1", 
            headers=HEADERS, 
            json=app_state
        )
        
        if update_res.status_code in [200, 204]:
            print("¡ÉXITO! Base de datos actualizada correctamente.")
            df_accesos = pd.DataFrame(nuevos_accesos)
            df_accesos.to_csv("accesos_generados_multiples.csv", index=False, encoding='utf-8-sig')
            print("Se ha generado el archivo 'accesos_generados_multiples.csv' con todas las credenciales.")
        else:
            print(f"ERROR al actualizar Supabase: {update_res.text}")
    else:
        print("No se encontraron registros válidos para importar.")

if __name__ == "__main__":
    main()
