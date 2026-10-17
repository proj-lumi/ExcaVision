import importlib.util
import tempfile
import unittest
from pathlib import Path

hook = Path(__file__).resolve().parents[1] / "scripts" / "load_environment.py"
spec = importlib.util.spec_from_file_location("load_environment", hook)
loader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loader)


class EnvironmentTests(unittest.TestCase):
    def test_missing_file_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "Copy"):
                loader.environment_header(directory, "production")

    def test_unknown_environment_rejected(self):
        with self.assertRaisesRegex(ValueError, "Select"):
            loader.environment_header(".", "preview")

    def test_targets_generate_different_urls_without_private_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            for target, letter in [("production", "a"), ("staging", "b")]:
                url = "https://" + letter * 20 + ".supabase.co"
                Path(directory, ".env." + target).write_text("SUPABASE_URL=" + url + "\n")
                header = loader.environment_header(directory, target)
                self.assertIn(url, header)
                self.assertIn(target.title(), header)
                self.assertNotIn("SECRET", header)

    def test_placeholder_and_non_https_urls_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            for url in ["https://STAGING_PROJECT_REF.supabase.co", "http://" + "a" * 20 + ".supabase.co", "https://example.com", "https://" + "a" * 20 + ".supabase.co/extra"]:
                Path(directory, ".env.staging").write_text("SUPABASE_URL=" + url + "\n")
                with self.assertRaisesRegex(ValueError, "SUPABASE_URL"):
                    loader.environment_header(directory, "staging")


if __name__ == "__main__":
    unittest.main()
