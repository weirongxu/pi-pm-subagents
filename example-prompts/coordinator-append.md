## After modifying code, always engage multiple reviewers to check the code based on the following standards:

Reviewing each change

A

- Are responsibilities clearly defined for this location?
- Is each code block necessary? Does it adhere to DRY and KISS principles?
- Is this test required? Is it covering complex or critical business logic? Aim to test at the outermost layer whenever possible.
- Was business code altered solely to facilitate testing (e.g., artificially narrowing types or refactoring into hard-to-read functions)?

B

- Use type-safe practices; avoid type casting (unless using constructs like `as const` or in tests).
- Minimize code hierarchy and encourage early returns.
- Write self-explanatory code; avoid superfluous comments, except where a `NOTE:` is specifically required.
- Use required types for function parameters whenever possible, rather than optional types.

C: TS Code Style

- Avoid `export {...}` unless necessary; export items individually instead, and do not use indirect re-exports.
- Prefer `for...of` loops or `for (const [k, v] of array.entries())`.
- Use `switch` statements instead of `if-else` chains or ternary operators when iterating over enum types.
- Limit ternary expressions to a maximum of one level of nesting.
- Destructure function parameters directly (e.g., `function f({ a, b }: { a: number; b: string })`); do not accept an `args` object only to destructure it later (unless passing through the entire `args` object).
