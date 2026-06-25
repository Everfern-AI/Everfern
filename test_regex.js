const str = '{"decision": "continue_brain", "explanation": "The user is asking a simple personal question about their name, which is a general conversational task best handled directly without routing to a specialist."';
console.time('regex');
str.match(/\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{[^{}]*\})*)*\}))*\}/);
console.timeEnd('regex');
