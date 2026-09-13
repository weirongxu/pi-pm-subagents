## After modifying code, always initiate multiple reviewers to check the code based on the following standards:

A

- Module files have clearly defined responsibilities, following the DRY + KISS principles.
- Do not alter business logic solely for the sake of testing.
- Avoid writing tests for every minute detail; focus testing on complex and critical business logic, ideally targeting the outermost layers.
- Do not modify business code to accommodate testing—such as artificially narrowing types or refactoring code into hard-to-read functions.
- Prioritize code readability above all else.

B

- Use type-safe practices; avoid type casting (except for cases like `as const` or testing).
- Minimize code nesting depth and favor early returns.
- Prefer self-documenting code over comments; do not add comments unless they begin with `NOTE:`.
- Use required types for function parameters whenever possible, rather than optional types.

C: TS Code Style

- Avoid `export {...}` unless necessary; use individual exports instead. Do not indirectly export modules from within the project.
- Prefer `for...of` loops and `for (const [k, v] of array.entries())`.
- Use `switch` statements instead of `if-else` chains or ternary operators when iterating over enum types.
- Limit ternary expressions to a single level of nesting.
- Destructure function parameters directly (e.g., `function f({ a, b }: { a: number; b: string })`); do not accept an `args` object only to destructure it later (unless passing through the entire `args` object).

## Important Notes

- Do not use `git mv` to rename files.
- Do not stage changes in Git.
