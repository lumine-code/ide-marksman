# ide-marksman

Marksman language-server adapter for Markdown.

## Features

- **Link intelligence**: completes, previews, and navigates Markdown, reference, and wiki links.
- **Project navigation**: finds definitions and references and exposes document and workspace headings.
- **Refactoring**: renames documents and headings together with their links.
- **Diagnostics**: reports broken, ambiguous, and duplicate wiki-link targets.
- **Actions and lenses**: manages tables of contents, creates linked documents, and counts heading references.
- **Managed server**: installs the official platform binary or uses an executable from settings or `PATH`.

## Installation

To install `ide-marksman`, search for _ide-marksman_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/ide-marksman`.

## Usage

Open a Markdown file inside a project folder. Marksman also supports single files, but cross-file completion and navigation require a project; a `.marksman.toml` file at its root is an explicit project marker.

## Configuration

Marksman reads project options from `.marksman.toml`. For example, this makes wiki links use file names, which is compatible with vaults that do not derive titles from headings:

```toml
[completion.wiki]
style = "file-stem"
```

The Server Path setting overrides both the editor-managed copy and `marksman` on `PATH`.

## Services

- **ide-client** (`^1.0.0`): consumed to register and run the Marksman language-server adapter.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
