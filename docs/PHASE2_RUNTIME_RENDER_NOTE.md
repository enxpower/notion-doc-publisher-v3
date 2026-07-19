# Phase 2 Conditional Render Runtime

Incremental publishing must keep true NOOP runs fast. Typst and CJK font installation is therefore required only when the lifecycle plan contains CREATE, UPDATE, or MOVE records. REMOVE and NOOP operations do not need the PDF rendering toolchain.
