# Project Agent Instructions

These instructions apply to every session working in this repository.

## Git and GitHub

- Do not create commits.
- Do not push or pull from remotes.
- Do not create, update, or merge pull requests.
- The project owner will manually handle commits, pushes, pulls, and pull requests.
- Read-only Git commands such as checking status, diffs, and history are allowed when useful.

## Database changes

- Do not use database migrations in this project.
- Do not create, run, or modify migration files or migration commands.
- If a database schema or data change is needed, provide the exact SQL query in the response.
- The project owner will execute the SQL manually in the Neon DB SQL Editor.
- Do not execute database-changing SQL or make database changes through application tooling.

## General workflow

- Keep implementation changes within the requested scope.
- If a requested change conflicts with these restrictions, explain the conflict and provide the safest compatible alternative.
