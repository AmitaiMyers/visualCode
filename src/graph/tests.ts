/**
 * True for test files in the languages VisualCode reads, by the conventions each ecosystem uses:
 * tests/, __tests__/, spec/ folders; *.test.*, *.spec.*; Go *_test.go; Python test_*.py / *_test.py;
 * Java/Kotlin/C# *Test(s).*; Ruby *_spec.rb.
 */
export function isTestPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (/(^|\/)(tests?|__tests__|spec|specs|test_?suite)\//i.test(path)) return true;
  return /\.(test|spec)\.[^.]+$/i.test(name) || /_test\.(go|py|rb|exs?)$/.test(name) || /^test_.*\.py$/.test(name) || /Tests?\.(java|kt|cs|swift|php)$/.test(name) || /_spec\.rb$/.test(name);
}
