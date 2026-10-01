```markdown
# cineprompt Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `cineprompt` TypeScript codebase, built with the Vite framework. You'll learn about file naming, import/export styles, commit message patterns, and how to write and run tests. This guide helps you contribute code that matches the project's established style and workflows.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `movieList.ts`, `userProfile.test.ts`

### Import Style
- Use **alias imports** for modules.
  - Example:
    ```typescript
    import { fetchMovies } from '@/services/movieService';
    ```

### Export Style
- **Mixed**: Both default and named exports are used.
  - Named export example:
    ```typescript
    export function getMovieTitle(id: string): string { ... }
    ```
  - Default export example:
    ```typescript
    export default MovieList;
    ```

### Commit Messages
- **Freeform**: No strict type or scope, but usually concise (~70 characters).
  - Example: `Add genre filter to movie search results`

## Workflows

### Adding a New Feature
**Trigger:** When you want to introduce new functionality.
**Command:** `/add-feature`

1. Create a new file using camelCase naming.
2. Write your feature code, using alias imports as needed.
3. Export your functions or components (default or named as appropriate).
4. Add or update relevant test files (`*.test.ts`).
5. Commit with a concise, descriptive message.
6. Open a pull request for review.

### Refactoring Code
**Trigger:** When improving or restructuring existing code.
**Command:** `/refactor`

1. Identify the code to refactor.
2. Update file names to camelCase if needed.
3. Use alias imports for any new or changed imports.
4. Adjust exports to maintain consistency (named or default).
5. Update or add tests to cover changes.
6. Commit with a clear message describing the refactor.

### Running Tests
**Trigger:** To verify your code changes.
**Command:** `/run-tests`

1. Locate test files matching the `*.test.*` pattern.
2. Use the project's test runner (framework unknown; check project scripts).
3. Run all tests and ensure they pass before committing.

## Testing Patterns

- Test files are named using the pattern: `*.test.*` (e.g., `movieList.test.ts`).
- Place tests alongside the code they cover or in a dedicated test directory.
- Use the project's test runner to execute tests (framework not specified; check `package.json` or documentation).

## Commands
| Command        | Purpose                                    |
|----------------|--------------------------------------------|
| /add-feature   | Start the process of adding a new feature  |
| /refactor      | Begin refactoring existing code            |
| /run-tests     | Run all tests in the codebase              |
```