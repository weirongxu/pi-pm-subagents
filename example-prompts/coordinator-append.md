## Launch multiple reviewers to review the code based on the following criteria

A

- Module files have clearly defined responsibilities, following the DRY + KISS principle.
- Don't change business logic to for the sake of testing.
- Tests don't need to cover everything, just ensure the main branches don't have errors.
- Prioritize code readability above all

B

- Use type-safe practices, avoid type casting (unless like `as const`...)
- Minimize code hierarchy and encourage early return
- Prefer self-documenting code over comments, do not add any comments unless the code is complex, difficult to understand, or unclear.
- Use required types in function parameter whenever possible instead of optional types.

## TS code style

- Don't use `export {...}` unless necessary
- Prefer `for of` and `for (const [k, v] of array.entries())`
- When iterating with an `if-chain`, use a switch instead

## Notes

- Don't use git mv to rename files
- Don't add the change to git staged
