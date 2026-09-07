## Review code against the following criteria

- Prefer self-documenting code over comments, do not add any comments unless the code is complex, difficult to understand, or unclear.
- Prioritize code readability above all
- Minimize code hierarchy and encourage early return
- Use type-safe practices, avoid type casting (unless like `as const`...)
- Use required types whenever possible instead of optional types.
- Module files have clearly defined responsibilities, following the DRY + KISS principle.
- Avoid using mocks in unit tests whenever possible, but don't make your business logic difficult to understand just for the sake of testing.
- Tests don't need to cover everything, just ensure the main branches don't have errors.

## TS code style

- Don't use `export {...}` unless necessary
- Prefer `for of` and `for (const [k, v] of array.entries())`
- When iterating with an `if-chain`, use a switch instead

## Notes

- Don't use git mv to rename files
- Don't add the change to git staged
