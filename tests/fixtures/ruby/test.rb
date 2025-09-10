#!/usr/bin/env ruby

def calculate_fibonacci(n)
  return n if n <= 1
  calculate_fibonacci(n - 1) + calculate_fibonacci(n - 2)
end

def find_primes(limit)
  primes = []
  (2..limit).each do |num|
    is_prime = true
    (2..Math.sqrt(num).to_i).each do |i|
      if num % i == 0
        is_prime = false
        break
      end
    end
    primes << num if is_prime
  end
  primes
end

def process_data
  data = (0...1000).to_a
  result = 0
  data.each_with_index do |val_i, i|
    data.each_with_index do |val_j, j|
      result += val_i * val_j
    end
  end
  result
end

def main
  puts "Starting Ruby test..."
  start_time = Time.now
  
  # Ensure we run for at least 1000ms
  iterations = 0
  while Time.now - start_time < 1.0
    calculate_fibonacci(25)  # Increased for more CPU time
    find_primes(500)  # Increased for more CPU time
    process_data
    iterations += 1
  end
  
  elapsed = Time.now - start_time
  puts "Completed #{iterations} iterations in #{'%.3f' % elapsed} seconds"
end

if __FILE__ == $0
  main
end