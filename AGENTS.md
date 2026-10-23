# Repository Guidelines

## Repository Status

This repository currently contains no application source, tests, assets, or build configuration. No framework, package manager, or automated development workflow has been established. Update this guide when those choices are made; do not assume commands or conventions from unrelated projects.

## Project Structure & Module Organization

Keep the root focused on project documentation and configuration. When adding the initial implementation, group application code in a clearly named directory such as `src/`, automated tests in `tests/`, and static resources in `assets/` when applicable. These are suggested locations, not existing directories. Document the actual layout as it develops, and keep related modules together.

## Build, Test, and Development Commands

No build, test, or local run commands are currently configured. When introducing tooling, document exact installation, development, build, and test commands in `README.md`. Prefer reproducible commands backed by checked-in configuration and a dependency lockfile where supported. Verify each documented command from the repository root before publishing it.

## Coding Style & Naming Conventions

Follow the idioms of the language selected for the project. Use consistent indentation and descriptive names within each module. Introduce formatter and linter configuration alongside the first source files, and document how to run them. Avoid unrelated formatting changes in functional patches.

## Testing Guidelines

No testing framework or coverage threshold is configured. Add tests for new behavior and regression tests for bug fixes once a test harness exists. Use descriptive test names that identify the behavior and expected result. Document test discovery patterns and execution commands with the harness.

## Commit & Pull Request Guidelines

No Git history is available here to establish a commit convention. Use concise, imperative commit subjects, such as `Add initial application scaffold`. Keep changes focused. Pull requests should explain the purpose, summarize behavior changes, link relevant issues, and report validation performed. Include screenshots for visual changes and identify any checks that could not be run.

## Security & Configuration

Never commit credentials or local secrets. Provide placeholder configuration examples when configuration is introduced, and exclude generated outputs and local environment files through `.gitignore`.
