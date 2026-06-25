const str = '<think>' + 'a'.repeat(5000000);
console.time('regex');
str.replace(/<think>[\s\S]*?<\/think>/g, '');
console.timeEnd('regex');
