"""Exporta dependencias estáticas entre archivos Python en formato JSON."""
import argparse
import ast
import json
import os
from pathlib import Path
import tokenize

EXCLUDED = {".git", ".venv", "venv", "__pycache__", "node_modules"}


def discover(root):
    modules = {}
    for directory, dirs, files in os.walk(root):
        dirs[:] = sorted(name for name in dirs if name not in EXCLUDED)
        for name in sorted(files):
            path = Path(directory, name)
            if path.suffix != ".py" or path.is_symlink():
                continue
            relative = path.relative_to(root)
            parts = relative.with_suffix("").parts
            package = name == "__init__.py"
            if package and len(parts) > 1:
                parts = parts[:-1]
            if all(part.isidentifier() for part in parts):
                modules.setdefault(".".join(parts), []).append((relative, package))
    return modules


def analyze(root):
    index = discover(root)
    modules = []
    warnings = []
    edges = set()

    def warn(kind, path, line, statement, message):
        warnings.append(dict(kind=kind, path=path, line=line,
                             statement=statement, message=message))

    def resolve(name):
        parts = name.split(".")
        for length in range(1, len(parts) + 1):
            prefix = ".".join(parts[:length])
            candidates = index.get(prefix, [])
            if len(candidates) > 1 or (
                length < len(parts) and candidates and not candidates[0][1]
            ):
                return "ambiguous"
        return "local" if name in index else "missing"

    trees = {}
    for name, candidates in sorted(index.items()):
        for relative, package in candidates:
            path = relative.as_posix()
            modules.append(dict(id=path, name=name, path=path, package=package))
            if resolve(name) == "ambiguous":
                warn("ambiguous", path, None, name, "Nombre de módulo ambiguo.")
            try:
                with tokenize.open(root / relative) as source:
                    trees[path] = ast.parse(source.read(), filename=path)
            except SyntaxError as error:
                warn("syntax", path, error.lineno, "", error.msg)
            except (OSError, UnicodeError) as error:
                warn("read", path, None, "", str(error))

    for module in modules:
        path = module["id"]
        if path not in trees:
            continue

        def connect(name, node, status):
            if status == "local":
                edges.add((path, index[name][0][0].as_posix()))
            else:
                kind = "ambiguous" if status == "ambiguous" else (
                    "unresolved" if isinstance(node, ast.ImportFrom) and node.level
                    else "external"
                )
                message = ("El nombre coincide con módulos incompatibles."
                           if kind == "ambiguous" else "Sin módulo interno resoluble.")
                warn(kind, path, node.lineno, name, message)

        for node in ast.walk(trees[path]):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    connect(alias.name, node, resolve(alias.name))
            elif isinstance(node, ast.ImportFrom):
                base = node.module or ""
                if node.level:
                    parts = module["name"].split(".")
                    if not module["package"] or path == "__init__.py":
                        parts = parts[:-1]
                    if len(parts) < node.level:
                        warn("unresolved", path, node.lineno, "." * node.level + base,
                             "El import relativo sale de la raíz de análisis.")
                        continue
                    prefix = ".".join(parts[:len(parts) - node.level + 1])
                    base = ".".join(filter(None, (prefix, base)))
                status = resolve(base)
                for alias in node.names:
                    child = f"{base}.{alias.name}"
                    child_status = resolve(child) if alias.name != "*" else "missing"
                    if child in index and child_status != "missing":
                        connect(child, node, child_status)
                    elif status == "local" and alias.name != "*" and alias.name != "__path__" and (
                        node.module is None and index[base][0][0].as_posix() == path
                    ):
                        warn("unresolved", path, node.lineno, child,
                             "No se encontró el submódulo ni se puede inferir el atributo.")
                    else:
                        connect(base, node, status)

    return dict(version=1, project=root.name, modules=modules,
                edges=[dict(source=source, target=target) for source, target in sorted(edges)],
                warnings=warnings)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path, help="Raíz de importación Python")
    parser.add_argument("-o", "--output", type=Path, help="Archivo JSON de salida")
    args = parser.parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        parser.error("La raíz debe ser una carpeta existente.")
    payload = json.dumps(analyze(root), ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(payload, encoding="utf-8")
    else:
        print(json.dumps(json.loads(payload), indent=2))


if __name__ == "__main__":
    main()
