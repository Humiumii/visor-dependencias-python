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
    initializer = root / "__init__.py"
    root_package = (root.name,) if (
        root.name.isidentifier() and initializer.is_file() and not initializer.is_symlink()
    ) else ()
    for directory, dirs, files in os.walk(root):
        dirs[:] = sorted(name for name in dirs if name not in EXCLUDED)
        for name in sorted(files):
            path = Path(directory, name)
            if path.suffix != ".py" or path.is_symlink():
                continue
            relative = path.relative_to(root)
            parts = root_package + relative.with_suffix("").parts
            package = name == "__init__.py"
            if package and len(parts) > 1:
                parts = parts[:-1]
            if all(part.isidentifier() for part in parts):
                modules.setdefault(".".join(parts), []).append((relative, package))
    return modules


def package_attributes(tree):
    """Detecta posibles atributos estáticos que compiten con un submódulo."""
    attributes = set()
    stack = list(tree.body)
    while stack:
        node = stack.pop()
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            attributes.add(node.name)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            attributes.add(node.id)
        elif isinstance(node, ast.Import):
            attributes.update(alias.asname or alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            # Un reexport homónimo desde un submódulo mediante "from . import"
            # es compatible con ese mismo submódulo.
            attributes.update(alias.asname or alias.name for alias in node.names
                              if node.level != 1 or node.module or alias.asname)
        elif isinstance(node, (ast.ExceptHandler, ast.MatchAs, ast.MatchStar)):
            if node.name:
                attributes.add(node.name)
            stack.extend(ast.iter_child_nodes(node))
        elif not isinstance(node, (ast.Lambda, ast.ListComp, ast.DictComp, ast.SetComp, ast.GeneratorExp)):
            stack.extend(ast.iter_child_nodes(node))
    return attributes


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
    attributes = {}
    for name, candidates in sorted(index.items()):
        for relative, package in candidates:
            path = relative.as_posix()
            modules.append(dict(id=path, name=name, path=path, package=package))
            if resolve(name) == "ambiguous":
                warn("ambiguous", path, None, name, "Nombre de módulo ambiguo.")
            try:
                with tokenize.open(root / relative) as source:
                    trees[path] = ast.parse(source.read(), filename=path)
                if package:
                    attributes[path] = package_attributes(trees[path])
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
                message = ("Hay más de una interpretación posible para este import."
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
                    if not module["package"]:
                        parts = parts[:-1]
                    if len(parts) < node.level:
                        warn("unresolved", path, node.lineno, "." * node.level + base,
                             "El import relativo sale de la raíz de análisis.")
                        continue
                    prefix = ".".join(parts[:len(parts) - node.level + 1])
                    base = ".".join(filter(None, (prefix, base)))
                status = resolve(base)
                base_path = index[base][0][0].as_posix() if status == "local" else None
                possible_attributes = attributes.get(base_path, set())
                for alias in node.names:
                    child = f"{base}.{alias.name}"
                    child_status = resolve(child) if alias.name != "*" else "missing"
                    if child in index and child_status != "missing":
                        if (alias.name in possible_attributes or
                                possible_attributes.intersection({"*", "__getattr__"}) or
                                (status == "local" and base_path not in trees)):
                            child_status = "ambiguous"
                        connect(child, node, child_status)
                    elif (status != "ambiguous" and node.module is None and
                          alias.name not in possible_attributes and alias.name not in {"*", "__path__"}):
                        warn("unresolved", path, node.lineno, child,
                             "No se encontró el submódulo ni se puede inferir el atributo.")
                    elif node.module is None and base_path == path:
                        # Leer un atributo conocido del propio paquete no añade una dependencia.
                        continue
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
    report = analyze(root)
    if args.output:
        payload = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        args.output.write_text(payload, encoding="utf-8")
    else:
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
