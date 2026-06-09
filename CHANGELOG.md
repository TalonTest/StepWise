# Changelog

All notable changes to StepWise will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] - 2026-06-09

### Added
- `stepwise.featurePaths` setting to scope diagnostics and `.feature` file watching to specific directories — useful in large monorepos to reduce noise and startup time. Leave empty to use the entire workspace ([#26](https://github.com/TalonTest/StepWise/issues/26), [#52](https://github.com/TalonTest/StepWise/pull/52))

### Changed
- Formatter now right-aligns data table columns whose cells are all numeric (Cucumber/Excel convention) and left-aligns text columns; the header row is excluded from the numeric check so a text label above numbers still right-aligns ([#27](https://github.com/TalonTest/StepWise/issues/27), [#53](https://github.com/TalonTest/StepWise/pull/53))

## [0.6.0] - 2026-05-18

### Added
- Document outline support for `.feature` files: the VS Code Outline panel and "Go to Symbol" picker now show a Feature → Rule → Scenario / Background / Scenario Outline → step hierarchy, with `Examples` blocks nested under their outline ([#48](https://github.com/TalonTest/StepWise/pull/48))
- Recognition of `Scenario Template`, `Example` (singular), and `Scenarios` keywords alongside their primary aliases when computing document symbols
- Symbol ranges extend through tag lines, comments, doc-strings, and data tables so the Outline panel highlights the correct block as the cursor moves

## [0.5.0] - 2026-05-12

### Added
- Hover support for matched step lines — shows the decorator, pattern, and source `file:line` of the matching definition
- Quick fix code action to generate a step definition stub for unresolved Gherkin steps

### Fixed
- Inconsistent "Stepwise" / "StepWise" capitalization across the repo and marketplace metadata

## [0.4.0] - 2026-05-12

### Added
- Gallery banner and VS Code Marketplace branding
- Extension keywords for improved discoverability
- GitHub Actions CI pipeline with typecheck, Jest, and pytest
- LSP request handler tests
- Informational log when the repository has no step definitions
- Release pipeline that publishes to the Marketplace and creates a GitHub Release on `v*` tag push
- This CHANGELOG

### Changed
- License updated to Apache 2.0
- Version string injected at build time rather than hard-coded
- `re.compile` patterns in completion item labels are now prettified for readability

### Fixed
- Missing `extensionPath` logging when the Python server starts

## [0.3.0] - 2026-05-11

### Changed
- Replaced extension icon with a vibrant, cucumber-themed design
- Added a dedicated cucumber icon for `.feature` files in the file explorer

## [0.2.0] - 2026-04-28

### Added
- Extension icon

### Fixed
- Stateful `g`-flag regex in step matching caused intermittent false negatives on repeated calls; replaced with non-global equivalent ([#1](https://github.com/ntibbenlembke/stepwise/issues/1))

## [0.1.0] - 2026-04-27

### Added
- LSP diagnostics: unresolved Gherkin steps are underlined with a warning
- Go-to-definition: jump from a step in a `.feature` file to its Python step definition
- Completion: step suggestions based on registered pytest-bdd definitions
- Gherkin document formatter with configurable indentation (registered as VS Code formatter for `.feature` files)
- Scenario Outline placeholder matching
- Keyword highlighting for `Given`, `When`, `Then`, `And`, `But`
- Regex caching in step matcher for improved performance
- User configuration via `stepwise.*` VS Code settings

### Fixed
- Formatter not recognized in marketplace installs: bundled server dependencies with esbuild so the extension is fully self-contained ([#2](https://github.com/ntibbenlembke/stepwise/issues/2))

[Unreleased]: https://github.com/ntibbenlembke/stepwise/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/ntibbenlembke/stepwise/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/ntibbenlembke/stepwise/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/ntibbenlembke/stepwise/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ntibbenlembke/stepwise/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ntibbenlembke/stepwise/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ntibbenlembke/stepwise/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ntibbenlembke/stepwise/releases/tag/v0.1.0
