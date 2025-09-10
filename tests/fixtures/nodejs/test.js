#!/usr/bin/env node

function calculateFibonacci(n) {
  if (n <= 1) return n;
  return calculateFibonacci(n - 1) + calculateFibonacci(n - 2);
}

function findPrimes(limit) {
  const primes = [];
  for (let num = 2; num <= limit; num++) {
    let isPrime = true;
    for (let i = 2; i <= Math.sqrt(num); i++) {
      if (num % i === 0) {
        isPrime = false;
        break;
      }
    }
    if (isPrime) {
      primes.push(num);
    }
  }
  return primes;
}

function processData() {
  const data = Array.from({ length: 1000 }, (_, i) => i);
  let result = 0;
  for (let i = 0; i < data.length; i++) {
    for (let j = 0; j < data.length; j++) {
      result += data[i] * data[j];
    }
  }
  return result;
}

function main() {
  console.log("Starting Node.js test...");
  const startTime = Date.now();
  
  // Ensure we run for at least 1000ms
  let iterations = 0;
  while (Date.now() - startTime < 1000) {
    calculateFibonacci(25);  // Increased for more CPU time
    findPrimes(500);  // Increased for more CPU time
    processData();
    iterations++;
  }
  
  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`Completed ${iterations} iterations in ${elapsed.toFixed(3)} seconds`);
}

main();