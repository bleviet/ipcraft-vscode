# =============================================================================
#  IPCraft for VS Code — CMake Orchestration Wrapper
# =============================================================================
#
#  This CMakeLists.txt is a meta-build orchestrator for a TypeScript/Node.js
#  VS Code extension.  It wraps npm scripts, Python-based documentation tools,
#  and developer utilities into a single, discoverable build interface.
#
#  Quick start:
#    cmake -B build          # Configure (one-time)
#    cmake --build build --target usage     # List every available target
#    cmake --build build --target setup     # First-time dev onboarding
#    cmake --build build --target test      # Run unit tests
#
# =============================================================================

cmake_minimum_required(VERSION 3.20)

project(IPCraftVSCode
    VERSION     0.1.0
    DESCRIPTION "Visual editor for FPGA IP Core and Memory Map specifications"
    LANGUAGES   NONE
)

# ─── Prevent in-source builds ─────────────────────────────────────────────────
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_BINARY_DIR)
    message(FATAL_ERROR
        "In-source builds are not allowed.\n"
        "Run:  cmake -B build   (creates an isolated build directory)")
endif()

# =============================================================================
#  TOOL DETECTION
# =============================================================================

find_program(NODE_EXECUTABLE  node  REQUIRED DOC "Node.js runtime (≥20)")
find_program(NPM_EXECUTABLE   npm   REQUIRED DOC "npm package manager")
find_program(NPX_EXECUTABLE   npx   REQUIRED DOC "npx package runner (ships with npm)")

find_program(PYTHON3_EXECUTABLE python3 DOC "Python 3 interpreter (required for docs targets)")

# ─── Node.js version guard (requires ≥20, matching CI) ───────────────────────
execute_process(
    COMMAND ${NODE_EXECUTABLE} --version
    OUTPUT_VARIABLE _NODE_VERSION_RAW
    OUTPUT_STRIP_TRAILING_WHITESPACE
)
string(REGEX REPLACE "^v([0-9]+).*" "\\1" _NODE_MAJOR "${_NODE_VERSION_RAW}")
if(_NODE_MAJOR LESS 20)
    message(FATAL_ERROR
        "Node.js 20 or later is required (found ${_NODE_VERSION_RAW}).\n"
        "Install it from https://nodejs.org/")
endif()
message(STATUS "Node.js ${_NODE_VERSION_RAW}  →  ${NODE_EXECUTABLE}")
message(STATUS "npm              →  ${NPM_EXECUTABLE}")

if(PYTHON3_EXECUTABLE)
    execute_process(
        COMMAND ${PYTHON3_EXECUTABLE} --version
        OUTPUT_VARIABLE _PY_VERSION
        OUTPUT_STRIP_TRAILING_WHITESPACE)
    message(STATUS "Python           →  ${PYTHON3_EXECUTABLE}  (${_PY_VERSION})")
else()
    message(STATUS "Python 3 not found — docs_* targets will be unavailable")
endif()

# =============================================================================
#  PATH SHORTCUTS
# =============================================================================

set(SRC_DIR           "${CMAKE_SOURCE_DIR}/src")
set(DIST_DIR          "${CMAKE_SOURCE_DIR}/dist")
set(OUT_DIR           "${CMAKE_SOURCE_DIR}/out")
set(COVERAGE_DIR      "${CMAKE_SOURCE_DIR}/coverage")
set(SITE_DIR          "${CMAKE_SOURCE_DIR}/site")
set(DOCS_DIR          "${CMAKE_SOURCE_DIR}/docs")
set(CONFIG_DIR        "${CMAKE_SOURCE_DIR}/config")
set(TEST_RESULTS_DIR  "${CMAKE_SOURCE_DIR}/test-results")
set(PW_REPORT_DIR     "${CMAKE_SOURCE_DIR}/playwright-report")

# =============================================================================
#  DEFAULT TARGET  (cmake --build build  with no --target)
# =============================================================================

add_custom_target(default_info ALL
    COMMAND ${CMAKE_COMMAND} -E echo ""
    COMMAND ${CMAKE_COMMAND} -E echo "  IPCraft for VS Code — build system ready."
    COMMAND ${CMAKE_COMMAND} -E echo "  Run:  cmake --build build --target usage"
    COMMAND ${CMAKE_COMMAND} -E echo "        for a full list of available targets."
    COMMAND ${CMAKE_COMMAND} -E echo ""
    VERBATIM
)

# =============================================================================
#  SECTION 1 — SETUP / INSTALL
# =============================================================================

# Standard developer install (respects package-lock.json)
add_custom_target(install_deps
    COMMAND ${NPM_EXECUTABLE} install
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Installing Node.js dependencies (npm install)"
    VERBATIM
)

# Clean, reproducible install — matches CI behaviour exactly
add_custom_target(install_ci
    COMMAND ${NPM_EXECUTABLE} ci
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Clean Node.js install (npm ci) — mirrors CI"
    VERBATIM
)

# Install Playwright browser engine (needed only once per machine for test_browser)
add_custom_target(install_browsers
    COMMAND ${NPX_EXECUTABLE} playwright install --with-deps chromium
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Installing Playwright Chromium browser"
    VERBATIM
)

# =============================================================================
#  SECTION 2 — CODE GENERATION
# =============================================================================

# Regenerate src/webview/types/*.d.ts from ipcraft-spec JSON schemas.
# Re-run whenever a schema changes in ipcraft-spec/schemas/.
add_custom_target(generate_types
    COMMAND ${NPM_EXECUTABLE} run generate-types
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Regenerating TypeScript types from JSON schemas → src/webview/types/"
    VERBATIM
)

# =============================================================================
#  SECTION 3 — BUILD
# =============================================================================

# Fast development build — source maps on, no minification
add_custom_target(compile
    COMMAND ${NPM_EXECUTABLE} run compile
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Development build: webpack (source maps enabled) → dist/"
    VERBATIM
)

# Production build — minified, hidden source maps (same as vscode:prepublish)
add_custom_target(build
    COMMAND ${NPM_EXECUTABLE} run package
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Production build: webpack --mode production → dist/"
    VERBATIM
)

# Compile the test TypeScript files to out/ (required before test_e2e)
add_custom_target(compile_tests
    COMMAND ${NPM_EXECUTABLE} run compile-tests
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Compiling test TypeScript → out/"
    VERBATIM
)

# Package the extension as a distributable .vsix file.
# Automatically triggers production build via vscode:prepublish.
add_custom_target(vsix
    COMMAND ${NPX_EXECUTABLE} vsce package
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Packaging extension → ipcraft-vscode-${PROJECT_VERSION}.vsix"
    VERBATIM
)

# List files that will be included in the .vsix without building it
add_custom_target(vsix_ls
    COMMAND ${NPX_EXECUTABLE} vsce ls
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Listing files included in the VSIX package"
    VERBATIM
)

# Webpack watch mode — stays running; rebuild on every file save
add_custom_target(watch
    COMMAND ${NPM_EXECUTABLE} run watch
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Webpack watch mode — rebuilds on change (Ctrl-C to stop)"
    VERBATIM
)

# Watch test compilation alongside watch (useful in a second terminal)
add_custom_target(watch_tests
    COMMAND ${NPM_EXECUTABLE} run watch-tests
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "tsc watch mode for tests → out/ (Ctrl-C to stop)"
    VERBATIM
)

# =============================================================================
#  SECTION 4 — QUALITY GATES  (lint / format / type-check)
# =============================================================================

# ESLint with zero-warning policy (matches CI)
add_custom_target(lint
    COMMAND ${NPM_EXECUTABLE} run lint
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "ESLint: zero-warning policy (src/**)"
    VERBATIM
)

# ESLint auto-fix — rewrites source files in place
add_custom_target(lint_fix
    COMMAND ${NPM_EXECUTABLE} run lint:fix
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "ESLint auto-fix (modifies source files)"
    VERBATIM
)

# Prettier — reformat all TS/TSX source files
add_custom_target(format
    COMMAND ${NPM_EXECUTABLE} run format
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Prettier: formatting src/**/*.{ts,tsx} (modifies files)"
    VERBATIM
)

# Prettier read-only check — reports what would change, exits non-zero if needed
add_custom_target(format_check
    COMMAND ${NPM_EXECUTABLE} run format:check
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Prettier: format check only (read-only, non-zero on violation)"
    VERBATIM
)

# TypeScript type checker — no output emitted, just errors
add_custom_target(type_check
    COMMAND ${NPM_EXECUTABLE} run type-check
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "TypeScript type check: tsc --noEmit"
    VERBATIM
)

# =============================================================================
#  SECTION 5 — TESTS
# =============================================================================

# Jest unit tests (fast, no compile needed)
add_custom_target(test
    COMMAND ${NPM_EXECUTABLE} run test:unit
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Jest unit tests (39 suites)"
    VERBATIM
)

# Jest unit tests with HTML + LCOV coverage report → coverage/
add_custom_target(test_coverage
    COMMAND ${NPM_EXECUTABLE} run test:unit:coverage
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Jest unit tests with coverage → coverage/lcov-report/index.html"
    VERBATIM
)

# Jest interactive watch mode — re-runs affected tests on save (great for TDD)
add_custom_target(test_watch
    COMMAND ${NPM_EXECUTABLE} run test:unit:watch
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Jest watch mode for TDD (Ctrl-C to stop)"
    VERBATIM
)

# VS Code E2E tests — launches a real VS Code instance via @vscode/test-electron.
# Requires a graphical display; use xvfb-run on headless servers.
add_custom_target(test_e2e
    COMMAND ${NPM_EXECUTABLE} run test:e2e
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "VS Code E2E tests (requires display — use xvfb-run on headless CI)"
    VERBATIM
)

# Playwright browser tests — Chromium headless, mirrors CI browser job
add_custom_target(test_browser
    COMMAND ${NPM_EXECUTABLE} run test:browser
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Playwright browser tests (Chromium headless) → test-results/"
    VERBATIM
)

# Full test suite — unit + e2e + browser (mirrors test:all in package.json)
add_custom_target(test_all
    COMMAND ${NPM_EXECUTABLE} run test:all
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "All test suites: unit + e2e + browser"
    VERBATIM
)

# Open the Playwright HTML report from the last test_browser run
add_custom_target(test_browser_report
    COMMAND ${NPX_EXECUTABLE} playwright show-report "${PW_REPORT_DIR}"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Opening Playwright HTML report"
    VERBATIM
)

# =============================================================================
#  SECTION 6 — SECURITY & DEPENDENCY HEALTH
# =============================================================================

# npm audit — report known vulnerabilities
add_custom_target(audit
    COMMAND ${NPM_EXECUTABLE} audit
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "npm audit: checking for known vulnerabilities"
    VERBATIM
)

# npm audit fix — auto-fix non-breaking vulnerabilities
add_custom_target(audit_fix
    COMMAND ${NPM_EXECUTABLE} audit fix
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "npm audit fix: auto-fixing non-breaking vulnerabilities"
    VERBATIM
)

# npm outdated — list packages with newer versions available
add_custom_target(outdated
    COMMAND ${NPM_EXECUTABLE} outdated
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "npm outdated: listing packages with newer versions available"
    VERBATIM
)

# Dependency health check — audit + outdated together
add_custom_target(deps_check
    COMMAND ${NPM_EXECUTABLE} audit
    COMMAND ${NPM_EXECUTABLE} outdated
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Dependency health: audit (security) + outdated (freshness)"
    VERBATIM
)

# =============================================================================
#  SECTION 7 — DOCUMENTATION
# =============================================================================

if(PYTHON3_EXECUTABLE)

    # Install MkDocs + Material theme into the current Python environment
    add_custom_target(docs_install
        COMMAND ${PYTHON3_EXECUTABLE} -m pip install -r "${DOCS_DIR}/requirements.txt"
        WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
        COMMENT "Installing docs Python dependencies (mkdocs, mkdocs-material, pymdown-extensions)"
        VERBATIM
    )

    # Build static HTML site into site/ — equivalent to CI docs build
    add_custom_target(docs_build
        COMMAND ${PYTHON3_EXECUTABLE} -m mkdocs build
        WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
        COMMENT "Building MkDocs documentation → site/"
        VERBATIM
    )

    # Build with --strict: treats warnings as errors (catches broken links etc.)
    add_custom_target(docs_check
        COMMAND ${PYTHON3_EXECUTABLE} -m mkdocs build --strict
        WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
        COMMENT "MkDocs strict build: warnings treated as errors"
        VERBATIM
    )

    # Live-reload development server at http://127.0.0.1:8000
    add_custom_target(docs_serve
        COMMAND ${PYTHON3_EXECUTABLE} -m mkdocs serve
        WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
        COMMENT "MkDocs dev server at http://127.0.0.1:8000 (Ctrl-C to stop)"
        VERBATIM
    )

    # Deploy to GitHub Pages via gh-deploy (requires push permissions)
    add_custom_target(docs_deploy
        COMMAND ${PYTHON3_EXECUTABLE} -m mkdocs gh-deploy --force
        WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
        COMMENT "Deploying documentation to GitHub Pages"
        VERBATIM
    )

else()
    message(STATUS
        "Docs targets (docs_install, docs_build, docs_check, docs_serve, docs_deploy) "
        "are unavailable — install Python 3 and re-run cmake -B build")
endif()

# =============================================================================
#  SECTION 8 — COMPOSITE / WORKFLOW TARGETS
# =============================================================================

# setup — complete first-time developer onboarding in one command:
#   npm install → generate-types → compile
add_custom_target(setup
    COMMAND ${NPM_EXECUTABLE} install
    COMMAND ${NPM_EXECUTABLE} run generate-types
    COMMAND ${NPM_EXECUTABLE} run compile
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "First-time dev setup: npm install + generate-types + compile"
    VERBATIM
)

# validate — the local PR readiness checklist from contributing/guidelines.md:
#   lint → type-check → unit tests → compile
add_custom_target(validate
    COMMAND ${NPM_EXECUTABLE} run lint
    COMMAND ${NPM_EXECUTABLE} run type-check
    COMMAND ${NPM_EXECUTABLE} run test:unit
    COMMAND ${NPM_EXECUTABLE} run compile
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "PR readiness check: lint + type-check + unit tests + compile"
    VERBATIM
)

# ci — mirrors the full GitHub Actions pipeline (ci.yml) locally.
#   Skips xvfb-based e2e tests (requires a real graphical session).
add_custom_target(ci
    COMMAND ${NPM_EXECUTABLE} run lint
    COMMAND ${NPM_EXECUTABLE} run type-check
    COMMAND ${NPM_EXECUTABLE} run compile
    COMMAND ${NPM_EXECUTABLE} run compile-tests
    COMMAND ${NPM_EXECUTABLE} run test:unit -- --coverage
    COMMAND ${NPX_EXECUTABLE} playwright install --with-deps chromium
    COMMAND ${NPM_EXECUTABLE} run test:browser
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Full CI pipeline locally (mirrors .github/workflows/ci.yml; e2e excluded)"
    VERBATIM
)

# =============================================================================
#  SECTION 9 — CLEAN
# =============================================================================

# Remove webpack output (extension + webview bundles)
add_custom_target(clean_dist
    COMMAND ${CMAKE_COMMAND} -E rm -rf "${DIST_DIR}"
    COMMENT "Removing dist/"
    VERBATIM
)

# Remove compiled test TypeScript output
add_custom_target(clean_out
    COMMAND ${CMAKE_COMMAND} -E rm -rf "${OUT_DIR}"
    COMMENT "Removing out/"
    VERBATIM
)

# Remove Jest coverage report
add_custom_target(clean_coverage
    COMMAND ${CMAKE_COMMAND} -E rm -rf "${COVERAGE_DIR}"
    COMMENT "Removing coverage/"
    VERBATIM
)

# Remove built MkDocs HTML site
add_custom_target(clean_site
    COMMAND ${CMAKE_COMMAND} -E rm -rf "${SITE_DIR}"
    COMMENT "Removing site/"
    VERBATIM
)

# Remove Playwright artefacts (test-results/ and playwright-report/)
add_custom_target(clean_playwright
    COMMAND ${CMAKE_COMMAND} -E rm -rf "${TEST_RESULTS_DIR}" "${PW_REPORT_DIR}"
    COMMENT "Removing Playwright artefacts (test-results/, playwright-report/)"
    VERBATIM
)

# Remove all build artefacts but keep node_modules (fast rebuild possible)
add_custom_target(clean_all
    COMMAND ${CMAKE_COMMAND} -E rm -rf
        "${DIST_DIR}"
        "${OUT_DIR}"
        "${COVERAGE_DIR}"
        "${SITE_DIR}"
        "${TEST_RESULTS_DIR}"
        "${PW_REPORT_DIR}"
    COMMENT "Removing all build artefacts (dist, out, coverage, site, test-results, playwright-report)"
    VERBATIM
)

# Nuclear option — remove everything including node_modules.
# Requires npm install (or cmake --build build --target install_deps) to recover.
add_custom_target(clean_deep
    COMMAND ${CMAKE_COMMAND} -E rm -rf
        "${DIST_DIR}"
        "${OUT_DIR}"
        "${COVERAGE_DIR}"
        "${SITE_DIR}"
        "${TEST_RESULTS_DIR}"
        "${PW_REPORT_DIR}"
        "${CMAKE_SOURCE_DIR}/node_modules"
    COMMENT "Removing all artefacts + node_modules (run install_deps to restore)"
    VERBATIM
)

# =============================================================================
#  SECTION 10 — USAGE / HELP
# =============================================================================

add_custom_target(usage
    COMMAND ${CMAKE_COMMAND} -E echo ""
    COMMAND ${CMAKE_COMMAND} -E echo "╔══════════════════════════════════════════════════════════════════╗"
    COMMAND ${CMAKE_COMMAND} -E echo "║   IPCraft for VS Code — Available CMake Build Targets           ║"
    COMMAND ${CMAKE_COMMAND} -E echo "╚══════════════════════════════════════════════════════════════════╝"
    COMMAND ${CMAKE_COMMAND} -E echo ""
    COMMAND ${CMAKE_COMMAND} -E echo "  Usage:  cmake --build build --target <target>"
    COMMAND ${CMAKE_COMMAND} -E echo ""
    COMMAND ${CMAKE_COMMAND} -E echo "  ── SETUP ───────────────────────────────────────────────────────"
    COMMAND ${CMAKE_COMMAND} -E echo "  setup              First-time onboarding: install + types + compile"
    COMMAND ${CMAKE_COMMAND} -E echo "  install_deps       npm install"
    COMMAND ${CMAKE_COMMAND} -E echo "  install_ci         npm ci  (clean, reproducible — matches CI)"
    COMMAND ${CMAKE_COMMAND} -E echo "  install_browsers   Install Playwright Chromium browser"
    COMMAND ${CMAKE_COMMAND} -E echo ""
    COMMAND ${CMAKE_COMMAND} -E echo "  ── CODE GENERATION ─────────────────────────────────────────────"
    COMMAND ${CMAKE_COMMAND} -E echo "  generate_types     Regenerate TS types from JSON schemas"
    COMMAND ${CMAKE_COMMAND} -E echo ""
    COMMAND ${CMAKE_COMMAND} -E echo "  ── BUILD ───────────────────────────────────────────────────────"
    COMMAND ${CMAKE_COMMAND} -E echo "  compile            Dev webpack build (fast, source maps on)"
    COMMAND ${CMAKE_COMMAND} -E echo "  build              Production webpack build (minified)"
    COMMAND ${CMAKE_COMMAND} -E echo "  compile_tests      Compile test TypeScript → out/"
    COMMAND ${CMAKE_COMMAND} -E echo "  vsix               Package extension as .vsix"
    COMMAND ${CMAKE_COMMAND} -E echo "  vsix_ls            List files that will be included in .vsix"
    COMMAND ${CMAKE_COMMAND} -E echo "  watch              Webpack watch mode (Ctrl-C to stop)"
    COMMAND ${CMAKE_COMMAND} -E echo "  watch_tests        tsc watch mode for tests (Ctrl-C to stop)"
    COMMAND ${CMAKE_COMMAND} -E echo ""
    COMMAND ${CMAKE_COMMAND} -E echo "  ── QUALITY GATES ───────────────────────────────────────────────"
    COMMAND ${CMAKE_COMMAND} -E echo "  lint               ESLint (zero-warning policy)"
    COMMAND ${CMAKE_COMMAND} -E echo "  lint_fix           ESLint auto-fix (modifies files)"
    COMMAND ${CMAKE_COMMAND} -E echo "  format             Prettier write (modifies files)"
    COMMAND ${CMAKE_COMMAND} -E echo "  format_check       Prettier check (read-only, CI-safe)"
    COMMAND ${CMAKE_COMMAND} -E echo "  type_check         TypeScript: tsc --noEmit"
    COMMAND ${CMAKE_COMMAND} -E echo ""
    COMMAND ${CMAKE_COMMAND} -E echo "  ── TESTS ───────────────────────────────────────────────────────"
    COMMAND ${CMAKE_COMMAND} -E echo "  test               Jest unit tests"
    COMMAND ${CMAKE_COMMAND} -E echo "  test_coverage      Jest unit tests + HTML/LCOV coverage report"
    COMMAND ${CMAKE_COMMAND} -E echo "  test_watch         Jest watch mode for TDD (Ctrl-C to stop)"
    COMMAND ${CMAKE_COMMAND} -E echo "  test_e2e           VS Code E2E tests (requires display / xvfb)"
    COMMAND ${CMAKE_COMMAND} -E echo "  test_browser       Playwright browser tests (Chromium headless)"
    COMMAND ${CMAKE_COMMAND} -E echo "  test_all           All suites: unit + e2e + browser"
    COMMAND ${CMAKE_COMMAND} -E echo "  test_browser_report  Open last Playwright HTML report"
    COMMAND ${CMAKE_COMMAND} -E echo ""
    COMMAND ${CMAKE_COMMAND} -E echo "  ── SECURITY & DEPENDENCY HEALTH ────────────────────────────────"
    COMMAND ${CMAKE_COMMAND} -E echo "  audit              npm audit (vulnerability report)"
    COMMAND ${CMAKE_COMMAND} -E echo "  audit_fix          npm audit fix (auto-fix non-breaking)"
    COMMAND ${CMAKE_COMMAND} -E echo "  outdated           npm outdated (freshness check)"
    COMMAND ${CMAKE_COMMAND} -E echo "  deps_check         audit + outdated combined"
    COMMAND ${CMAKE_COMMAND} -E echo ""
    COMMAND ${CMAKE_COMMAND} -E echo "  ── DOCUMENTATION (requires Python 3) ───────────────────────────"
    COMMAND ${CMAKE_COMMAND} -E echo "  docs_install       pip install docs/requirements.txt"
    COMMAND ${CMAKE_COMMAND} -E echo "  docs_build         mkdocs build → site/"
    COMMAND ${CMAKE_COMMAND} -E echo "  docs_check         mkdocs build --strict (warnings = errors)"
    COMMAND ${CMAKE_COMMAND} -E echo "  docs_serve         mkdocs dev server at http://127.0.0.1:8000"
    COMMAND ${CMAKE_COMMAND} -E echo "  docs_deploy        mkdocs gh-deploy → GitHub Pages"
    COMMAND ${CMAKE_COMMAND} -E echo ""
    COMMAND ${CMAKE_COMMAND} -E echo "  ── COMPOSITE WORKFLOWS ─────────────────────────────────────────"
    COMMAND ${CMAKE_COMMAND} -E echo "  validate           PR readiness: lint+type-check+test+compile"
    COMMAND ${CMAKE_COMMAND} -E echo "  ci                 Full CI pipeline (mirrors ci.yml, no xvfb)"
    COMMAND ${CMAKE_COMMAND} -E echo ""
    COMMAND ${CMAKE_COMMAND} -E echo "  ── CLEAN ───────────────────────────────────────────────────────"
    COMMAND ${CMAKE_COMMAND} -E echo "  clean_dist         Remove dist/"
    COMMAND ${CMAKE_COMMAND} -E echo "  clean_out          Remove out/"
    COMMAND ${CMAKE_COMMAND} -E echo "  clean_coverage     Remove coverage/"
    COMMAND ${CMAKE_COMMAND} -E echo "  clean_site         Remove site/"
    COMMAND ${CMAKE_COMMAND} -E echo "  clean_playwright   Remove test-results/ and playwright-report/"
    COMMAND ${CMAKE_COMMAND} -E echo "  clean_all          Remove all build artefacts"
    COMMAND ${CMAKE_COMMAND} -E echo "  clean_deep         Remove all artefacts + node_modules"
    COMMAND ${CMAKE_COMMAND} -E echo ""
    VERBATIM
)
