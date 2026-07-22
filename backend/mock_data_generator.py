# mock_data_generator.py
import pandas as pd
import numpy as np
import os

def generar_mock_data_profesional():
    """
    Genera un archivo 'mock_data.xlsx' con datos de agentes distribuidos
    de forma realista para simular un escenario de negocio complejo.
    """
    print("Generando archivo de datos de prueba profesional: 'mock_data.xlsx'...")

    # --- Parámetros de Simulación ---
    num_agentes = 50
    
    # Direcciones realistas mapeadas a las micro-zonas deseadas
    direcciones_por_zona = {
        "Comas 1": ["Av. Universitaria, Comas", "Urb. El Pinar, Comas", "Av. Metropolitana, Comas"],
        "Comas 2": ["Av. Túpac Amaru, Comas", "Collique, 5ta Zona", "Av. Belaunde, Comas"],
        "Callao 1": ["Av. Faucett, Callao", "Aeropuerto Jorge Chávez, Callao", "Av. Elmer Faucett, Callao"],
        "Surco Sur": ["Av. Benavides, Surco", "Urb. Casuarinas, Surco", "Av. Primavera, Surco"],
        "San Miguel Centro": ["Av. La Marina, San Miguel", "Plaza San Miguel, San Miguel", "Av. Riva Agüero, San Miguel"]
    }
    
    horarios = ["08:00 AM", "10:00 AM", "06:00 PM"]
    sedes = ["Torre Kapital", "Centro de Operaciones", "Sede Principal"]

    # --- Generación de Datos ---
    lista_agentes = []
    for i in range(num_agentes):
        zona = np.random.choice(list(direcciones_por_zona.keys()))
        direccion = np.random.choice(direcciones_por_zona[zona])
        lista_agentes.append({
            "ID Agente": f"KAP-AG-{1000+i}",
            "Dirección/Distrito": direccion,
            "Sede de Destino": np.random.choice(sedes),
            "Horario Turno": np.random.choice(horarios, p=[0.4, 0.3, 0.3]) # Más agentes en la mañana
        })

    df_agentes = pd.DataFrame(lista_agentes)

    # --- Guardado del Archivo ---
    output_filename = "mock_data.xlsx"
    # Guardar en el directorio del script para evitar problemas de ruta
    script_dir = os.path.dirname(__file__)
    file_path = os.path.join(script_dir, output_filename)
    df_agentes.to_excel(file_path, sheet_name="Agentes", index=False)

    print(f"'{output_filename}' generado exitosamente en '{script_dir}' con {num_agentes} agentes.")
    print("Ejecuta 'python mock_data_generator.py' en tu terminal para crear el archivo.")

if __name__ == "__main__":
    generar_mock_data_profesional()
