from __future__ import annotations

import argparse
import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"


def table_exists(cur, table_name: str) -> bool:
    cur.execute("SELECT to_regclass(%s)", (f"public.{table_name}",))
    return cur.fetchone()[0] is not None


def count_rows(cur, sql: str) -> int:
    cur.execute(sql)
    return int(cur.fetchone()[0])


def reset_user_sequence(cur) -> None:
    if not table_exists(cur, "usuarios"):
        return

    cur.execute("SELECT COALESCE(MAX(id), 0) FROM usuarios")
    max_id = int(cur.fetchone()[0] or 0)
    next_id = max_id + 1

    if not table_exists(cur, "usuarios_id_seq"):
        return

    if max_id == 0:
        cur.execute("SELECT setval('usuarios_id_seq', 1, false)")
    else:
        cur.execute("SELECT setval('usuarios_id_seq', %s, false)", (next_id,))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Borra solicitudes, datos relacionados y usuarios cliente; reinicia contadores."
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Ejecuta sin pedir confirmacion interactiva.",
    )
    args = parser.parse_args()

    load_dotenv(ENV_PATH)
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL no esta configurada en backend/.env")

    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        before = {
            "clientes": count_rows(cur, "SELECT COUNT(*) FROM usuarios WHERE rol = 'cliente'"),
            "vehiculos": count_rows(cur, "SELECT COUNT(*) FROM vehiculos") if table_exists(cur, "vehiculos") else 0,
            "solicitudes": count_rows(cur, "SELECT COUNT(*) FROM solicitudes") if table_exists(cur, "solicitudes") else 0,
            "diagnosticos": count_rows(cur, "SELECT COUNT(*) FROM diagnosticos") if table_exists(cur, "diagnosticos") else 0,
            "notificaciones": count_rows(cur, "SELECT COUNT(*) FROM notificaciones") if table_exists(cur, "notificaciones") else 0,
            "ordenes": count_rows(cur, "SELECT COUNT(*) FROM ordenes") if table_exists(cur, "ordenes") else 0,
            "pagos": count_rows(cur, "SELECT COUNT(*) FROM pagos") if table_exists(cur, "pagos") else 0,
            "cotizaciones": count_rows(cur, "SELECT COUNT(*) FROM cotizaciones") if table_exists(cur, "cotizaciones") else 0,
            "repuestos_solicitados": count_rows(cur, "SELECT COUNT(*) FROM repuestos_solicitados") if table_exists(cur, "repuestos_solicitados") else 0,
        }

        print("Resumen antes del borrado:")
        for key, value in before.items():
            print(f"  {key}: {value}")

        if not args.yes:
            answer = input(
                "Esto borrara solicitudes, vehiculos, notificaciones, clientes y reiniciara contadores. Escribe SI para continuar: "
            ).strip()
            if answer != "SI":
                print("Operacion cancelada.")
                return 0

        tables_to_truncate = [
            table
            for table in [
                "pagos",
                "ordenes",
                "diagnosticos",
                "cotizaciones",
                "repuestos_solicitados",
                "notificaciones",
                "solicitudes",
                "vehiculos",
            ]
            if table_exists(cur, table)
        ]

        if tables_to_truncate:
            cur.execute(
                f"TRUNCATE TABLE {', '.join(tables_to_truncate)} RESTART IDENTITY CASCADE"
            )

        if table_exists(cur, "usuarios"):
            cur.execute("DELETE FROM usuarios WHERE rol = 'cliente'")
            reset_user_sequence(cur)

        conn.commit()

        after = {
            "clientes": count_rows(cur, "SELECT COUNT(*) FROM usuarios WHERE rol = 'cliente'"),
            "vehiculos": count_rows(cur, "SELECT COUNT(*) FROM vehiculos") if table_exists(cur, "vehiculos") else 0,
            "solicitudes": count_rows(cur, "SELECT COUNT(*) FROM solicitudes") if table_exists(cur, "solicitudes") else 0,
            "diagnosticos": count_rows(cur, "SELECT COUNT(*) FROM diagnosticos") if table_exists(cur, "diagnosticos") else 0,
            "notificaciones": count_rows(cur, "SELECT COUNT(*) FROM notificaciones") if table_exists(cur, "notificaciones") else 0,
            "ordenes": count_rows(cur, "SELECT COUNT(*) FROM ordenes") if table_exists(cur, "ordenes") else 0,
            "pagos": count_rows(cur, "SELECT COUNT(*) FROM pagos") if table_exists(cur, "pagos") else 0,
            "cotizaciones": count_rows(cur, "SELECT COUNT(*) FROM cotizaciones") if table_exists(cur, "cotizaciones") else 0,
            "repuestos_solicitados": count_rows(cur, "SELECT COUNT(*) FROM repuestos_solicitados") if table_exists(cur, "repuestos_solicitados") else 0,
        }

        print("\nResumen despues del borrado:")
        for key, value in after.items():
            print(f"  {key}: {value}")

        print("\nReset completado.")
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
