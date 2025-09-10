#!/usr/bin/env php
<?php

function calculate_fibonacci($n) {
    if ($n <= 1) return $n;
    return calculate_fibonacci($n - 1) + calculate_fibonacci($n - 2);
}

function find_primes($limit) {
    $primes = [];
    for ($num = 2; $num <= $limit; $num++) {
        $is_prime = true;
        for ($i = 2; $i <= sqrt($num); $i++) {
            if ($num % $i == 0) {
                $is_prime = false;
                break;
            }
        }
        if ($is_prime) {
            $primes[] = $num;
        }
    }
    return $primes;
}

function process_data() {
    $data = range(0, 999);
    $result = 0;
    for ($i = 0; $i < count($data); $i++) {
        for ($j = 0; $j < count($data); $j++) {
            $result += $data[$i] * $data[$j];
        }
    }
    return $result;
}

function main() {
    echo "Starting PHP test...\n";
    $start_time = microtime(true);
    
    // Ensure we run for at least 1000ms
    $iterations = 0;
    while (microtime(true) - $start_time < 1.0) {
        calculate_fibonacci(25);  // Increased for more CPU time
        find_primes(500);  // Increased for more CPU time
        process_data();
        $iterations++;
    }
    
    $elapsed = microtime(true) - $start_time;
    printf("Completed %d iterations in %.3f seconds\n", $iterations, $elapsed);
}

main();