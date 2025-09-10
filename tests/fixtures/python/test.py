#!/usr/bin/env python3

import time

def calculate_fibonacci(n):
    if n <= 1:
        return n
    return calculate_fibonacci(n - 1) + calculate_fibonacci(n - 2)

def find_primes(limit):
    primes = []
    for num in range(2, limit + 1):
        is_prime = True
        for i in range(2, int(num ** 0.5) + 1):
            if num % i == 0:
                is_prime = False
                break
        if is_prime:
            primes.append(num)
    return primes

def process_data():
    data = list(range(1000))
    result = 0
    for i in range(len(data)):
        for j in range(len(data)):
            if i < len(data) and j < len(data):
                result += data[i] * data[j]
    return result

def main():
    print("Starting Python test...")
    start_time = time.time()
    
    # Ensure we run for at least 1000ms
    iterations = 0
    while time.time() - start_time < 1.0:
        calculate_fibonacci(25)  # Increased for more CPU time
        find_primes(500)  # Increased for more CPU time
        process_data()
        iterations += 1
    
    elapsed = time.time() - start_time
    print(f"Completed {iterations} iterations in {elapsed:.3f} seconds")

if __name__ == "__main__":
    main()