# Atelier skills

A skill is a short Markdown document of instructions for a model playing one role (here the scriptwriter). It states a
goal, rules, a procedure and a self-check. Skills are plain text, so they can be read, edited and versioned like code.

## Licence
These skills are written by and for Atelier. They are proprietary to Atelier and ship with the application. They are
original text: nothing in them comes from a third-party product.

## Layout
- `script/hook.md`: the first fifteen seconds.
- `script/retention.md`: beats, open loops, ordering of material, spoken style, truth over drama.
- `script/rehooks.md`: re-engagement lines between beats.
- `script/cta.md`: calls to action, in the middle and at the end.

A skill is addressed by its file name without extension (`hook`, `retention`, `rehooks`, `cta`).

## How nodes load them
The `script.write` node has a `skills` parameter, a list of names (default: the four above). At run time it reads each
`resources/skills/script/<name>.md` through the library service (`library.root`) and injects the text into the system
prompt of the writing calls, after the output-language line. An unknown name is a parameter error and stops the node
before any model call. Keep each skill under about 60 lines: they are sent with every writing call.
