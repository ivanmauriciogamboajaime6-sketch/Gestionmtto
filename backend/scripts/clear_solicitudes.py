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


def count_rows(cur, sql: str, params: tuple | None = None) -> int:
    cur.execute(sql, params or ())
    return int(cur.fetchone()[0] or 0)


def delete_notifications_for_solicitudes(cur) -> int:
    if not table_exists(cur, "notificaciones"):
        return 0

    cur.execute(
        """
        DELETE FROM notificaciones
        WHERE mensaje ILIKE '%%solicitud #%%'
           OR titulo ILIKE '%%solicitud #%%'
        """
    )
    return cur.rowcount or 0


def reset_sequence(cur, table_name: str) -> None:
    sequence_name = f"{table_name}_id_seq"
    if not table_exists(cur, sequence_name):
        return
    cur.execute(f"SELECT setval('{sequence_name}', 1, false)")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Borra solicitudes de forma reutilizable y, opcionalmente, notificaciones relacionadas."
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Ejecuta sin pedir confirmacion interactiva.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Solo muestra lo que borraria, sin aplicar cambios.",
    )
    parser.add_argument(
        "--keep-notifications",
        action="store_true",
        help="Conserva las notificaciones aunque se borren las solicitudes.",
    )
    parser.add_argument(
        "--no-reset-identity",
        action="store_true",
        help="No reinicia la secuencia de IDs de solicitudes.",
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
        if not table_exists(cur, "solicitudes"):
            print("La tabla solicitudes no existe. No hay nada por borrar.")
            return 0

        before_solicitudes = count_rows(cur, "SELECT COUNT(*) FROM solicitudes")
        before_notificaciones = (
            count_rows(cur, "SELECT COUNT(*) FROM notificaciones")
            if table_exists(cur, "notificaciones")
            else 0
        )
        related_notifications = (
            count_rows(
                cur,
                """
                SELECT COUNT(*)
                FROM notificaciones
                WHERE mensaje ILIKE '%%solicitud #%%'
                   OR titulo ILIKE '%%solicitud #%%'
                """,
            )
            if table_exists(cur, "notificaciones")
            else 0
        )

        print("Resumen previo:")
        print(f"  solicitudes: {before_solicitudes}")
        print(f"  notificaciones totales: {before_notificaciones}")
        print(f"  notificaciones relacionadas con solicitudes: {related_notifications}")

        if args.dry_run:
            print("\nDry run completado. No se hicieron cambios.")
            conn.rollback()
            return 0

        if not args.yes:
            answer = input(
                "Esto borrara todas las solicitudes"
                + ("" if args.keep_notifications else " y las notificaciones relacionadas")
                + ". Escribe SI para continuar: "
            ).strip()
            if answer != "SI":
                print("Operacion cancelada.")
                conn.rollback()
                return 0

        deleted_notifications = 0
        if not args.keep_notifications:
            deleted_notifications = delete_notifications_for_solicitudes(cur)

        cur.execute("DELETE FROM solicitudes")
        deleted_solicitudes = cur.rowcount or 0

        if not args.no_reset_identity:
            reset_sequence(cur, "solicitudes")

        conn.commit()

        after_solicitudes = count_rows(cur, "SELECT COUNT(*) FROM solicitudes")
        after_notificaciones = (
            count_rows(cur, "SELECT COUNT(*) FROM notificaciones")
            if table_exists(cur, "notificaciones")
            else 0
        )

        print("\nResultado:")
        print(f"  solicitudes borradas: {deleted_solicitudes}")
        print(f"  notificaciones borradas: {deleted_notifications}")
        print(f"  solicitudes restantes: {after_solicitudes}")
        print(f"  notificaciones restantes: {after_notificaciones}")
        print("\nLimpieza completada.")
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
