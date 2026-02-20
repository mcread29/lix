---
description format a prompt from the user input
---

<context>

the user is requesting you to rewrite their prompt in a specific format to be passed to an agent

</context>

<userInput>

$ARGUMENTS

</userInput>

<task>

format the output as follows:

```md
<context>
{information needed for task}
</context>

<task>
{task to be completed by the agent}
</task>

<constraints>
{what NOT to do, parameters, musts and nevers}
</constraints>

<format>
{what the result of the function/script/task should be}
</format>
```

</task>
