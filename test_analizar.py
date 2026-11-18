import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from analizar import analyze


class AnalyzerTest(unittest.TestCase):
    def test_nested_packages_external_syntax_and_no_execution(self):
        files = {
            "pkg/__init__.py": "",
            "pkg/nested/__init__.py": "from . import core\n",
            "pkg/nested/core.py": "from .. import util\nfrom pkg.nested import broken\n"
                                  "import requests\nraise RuntimeError('never execute')\n",
            "pkg/util.py": "from pkg.nested.core import value\n",
            "pkg/nested/broken.py": "if :\n",
            "entry.py": "import pkg\n",
        }
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for name, source in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(source, encoding="utf-8")
            report = analyze(root)
            expected = {
                ("pkg/nested/__init__.py", "pkg/nested/core.py"),
                ("pkg/nested/core.py", "pkg/util.py"),
                ("pkg/nested/core.py", "pkg/nested/broken.py"),
                ("pkg/util.py", "pkg/nested/core.py"),
                ("entry.py", "pkg/__init__.py"),
            }
            self.assertEqual({(e["source"], e["target"]) for e in report["edges"]}, expected)
            self.assertEqual({w["kind"] for w in report["warnings"]}, {"external", "syntax"})
            output = root / "report.json"
            subprocess.run([sys.executable, str(Path(__file__).with_name("analizar.py")),
                            directory, "-o", str(output)], check=True)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), report)

    def test_ambiguous_module_and_relative_escape(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "a").mkdir()
            (root / "a" / "__init__.py").touch()
            (root / "a.py").touch()
            (root / "entry.py").write_text("import a\nfrom . import a\n")
            report = analyze(root)
            self.assertEqual(report["edges"], [])
            self.assertEqual({w["kind"] for w in report["warnings"]},
                             {"ambiguous", "unresolved"})


if __name__ == "__main__":
    unittest.main()
