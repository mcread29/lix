---
description: format a prompt from the user input
---

<context>

the user is making a request. take the user's words and rewrite them to fit the format. ask questions if necessary

</context>

<userInput>

$ARGUMENTS

</userInput>

<task>

format the output as follows:

```md
context: {information needed for task}
task: {task to be completed by the agent}
constraints: {what NOT to do, parameters, musts and nevers}
format: what the result of the function/script/task should be
```

</task>
