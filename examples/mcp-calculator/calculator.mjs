import { z } from 'zod';

export const calculatorInput = z.strictObject({
  left: z.number().finite(),
  operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
  right: z.number().finite(),
});

const operations = {
  add: [(a, b) => a + b, '+'],
  subtract: [(a, b) => a - b, '−'],
  multiply: [(a, b) => a * b, '×'],
  divide: [(a, b) => a / b, '÷'],
};

function failure(message) {
  return { isError: true, content: [{ type: 'text', text: message }], structuredContent: { error: message } };
}

export function calculate({ left, operation, right }) {
  if (operation === 'divide' && right === 0) return failure('Cannot divide by zero.');
  const [apply, symbol] = operations[operation];
  const value = apply(left, right);
  if (!Number.isFinite(value)) return failure('Result is outside the finite number range.');
  return {
    content: [{ type: 'text', text: `${left} ${symbol} ${right} = ${value}` }],
    structuredContent: { value },
  };
}
