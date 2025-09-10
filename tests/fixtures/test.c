#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>

#define MATRIX_SIZE 800       // Increased from 500
#define PRIME_LIMIT 500000    // Increased from 100000
#define SORT_SIZE 100000      // Increased from 50000
#define ITERATIONS 10         // Increased from 5

// Expensive operation 1: Matrix multiplication
void matrix_multiply(double **a, double **b, double **c, int n) {
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < n; j++) {
            c[i][j] = 0;
            for (int k = 0; k < n; k++) {
                c[i][j] += a[i][k] * b[k][j];
            }
        }
    }
}

// Expensive operation 2: Prime number calculation (Sieve of Eratosthenes)
int* calculate_primes(int limit, int *count) {
    char *is_prime = calloc(limit + 1, sizeof(char));
    memset(is_prime, 1, limit + 1);
    is_prime[0] = is_prime[1] = 0;
    
    for (int i = 2; i * i <= limit; i++) {
        if (is_prime[i]) {
            for (int j = i * i; j <= limit; j += i) {
                is_prime[j] = 0;
            }
        }
    }
    
    // Count primes
    *count = 0;
    for (int i = 2; i <= limit; i++) {
        if (is_prime[i]) (*count)++;
    }
    
    // Collect primes
    int *primes = malloc(*count * sizeof(int));
    int idx = 0;
    for (int i = 2; i <= limit; i++) {
        if (is_prime[i]) primes[idx++] = i;
    }
    
    free(is_prime);
    return primes;
}

// Expensive operation 3: Recursive Fibonacci (intentionally inefficient)
long long fibonacci_recursive(int n) {
    if (n <= 1) return n;
    return fibonacci_recursive(n - 1) + fibonacci_recursive(n - 2);
}

// Expensive operation 4: Bubble sort (intentionally inefficient)
void bubble_sort(int *arr, int n) {
    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < n - i - 1; j++) {
            if (arr[j] > arr[j + 1]) {
                int temp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = temp;
            }
        }
    }
}

// Expensive operation 5: String manipulation
char* string_manipulation(const char *input, int iterations) {
    int len = strlen(input);
    char *result = malloc(len + 1);
    strcpy(result, input);
    
    for (int iter = 0; iter < iterations; iter++) {
        // Reverse the string
        for (int i = 0; i < len / 2; i++) {
            char temp = result[i];
            result[i] = result[len - 1 - i];
            result[len - 1 - i] = temp;
        }
        
        // Convert case
        for (int i = 0; i < len; i++) {
            if (result[i] >= 'a' && result[i] <= 'z') {
                result[i] = result[i] - 'a' + 'A';
            } else if (result[i] >= 'A' && result[i] <= 'Z') {
                result[i] = result[i] - 'A' + 'a';
            }
        }
        
        // Additional work: character rotation
        for (int i = 0; i < len; i++) {
            if ((result[i] >= 'a' && result[i] < 'z') || (result[i] >= 'A' && result[i] < 'Z')) {
                result[i] = result[i] + 1;
            } else if (result[i] == 'z') {
                result[i] = 'a';
            } else if (result[i] == 'Z') {
                result[i] = 'A';
            }
        }
    }
    
    return result;
}

// Expensive operation 6: Memory allocation stress test
void memory_stress_test(int iterations) {
    void **buffers = malloc(iterations * sizeof(void*));
    int allocated = 0;
    
    for (int i = 0; i < iterations; i++) {
        // Allocate random sized blocks
        int size = (rand() % 2000 + 1) * 1024; // 1KB to 2MB
        char *buffer = malloc(size);
        
        if (buffer) {
            // Write to memory to ensure it's actually allocated
            for (int j = 0; j < size; j += 1024) {
                buffer[j] = (char)(j % 256);
                // Do some computation to prevent optimization
                buffer[j] = (char)((buffer[j] * 17 + 31) % 256);
            }
            
            buffers[allocated++] = buffer;
        }
    }
    
    // Free all allocated memory
    for (int i = 0; i < allocated; i++) {
        free(buffers[i]);
    }
    free(buffers);
}

// Expensive operation 7: Floating point computations
double compute_mandelbrot(double x0, double y0, int max_iter) {
    double x = 0, y = 0;
    int iter = 0;
    
    while (x*x + y*y <= 4 && iter < max_iter) {
        double xtemp = x*x - y*y + x0;
        y = 2*x*y + y0;
        x = xtemp;
        iter++;
    }
    
    return (double)iter / max_iter;
}

void mandelbrot_set(int width, int height) {
    double *values = malloc(width * height * sizeof(double));
    
    for (int py = 0; py < height; py++) {
        for (int px = 0; px < width; px++) {
            double x0 = (px - width/2.0) * 4.0 / width;
            double y0 = (py - height/2.0) * 4.0 / height;
            values[py * width + px] = compute_mandelbrot(x0, y0, 256); // Increased iterations
        }
    }
    
    // Do some additional computation with the results
    double sum = 0;
    for (int i = 0; i < width * height; i++) {
        sum += values[i];
        values[i] = sqrt(values[i]) * sin(values[i]);
    }
    
    free(values);
}

// Additional expensive operation 8: N-body simulation
typedef struct {
    double x, y, z;
    double vx, vy, vz;
    double mass;
} Body;

void nbody_simulation(int n_bodies, int steps) {
    Body *bodies = malloc(n_bodies * sizeof(Body));
    
    // Initialize bodies with random positions and velocities
    for (int i = 0; i < n_bodies; i++) {
        bodies[i].x = (double)rand() / RAND_MAX * 1000 - 500;
        bodies[i].y = (double)rand() / RAND_MAX * 1000 - 500;
        bodies[i].z = (double)rand() / RAND_MAX * 1000 - 500;
        bodies[i].vx = (double)rand() / RAND_MAX * 10 - 5;
        bodies[i].vy = (double)rand() / RAND_MAX * 10 - 5;
        bodies[i].vz = (double)rand() / RAND_MAX * 10 - 5;
        bodies[i].mass = (double)rand() / RAND_MAX * 100 + 1;
    }
    
    double dt = 0.01;
    double G = 6.67430e-11;
    
    for (int step = 0; step < steps; step++) {
        // Calculate forces
        for (int i = 0; i < n_bodies; i++) {
            double fx = 0, fy = 0, fz = 0;
            
            for (int j = 0; j < n_bodies; j++) {
                if (i != j) {
                    double dx = bodies[j].x - bodies[i].x;
                    double dy = bodies[j].y - bodies[i].y;
                    double dz = bodies[j].z - bodies[i].z;
                    double r2 = dx*dx + dy*dy + dz*dz + 1e-10; // avoid division by zero
                    double r = sqrt(r2);
                    double f = G * bodies[i].mass * bodies[j].mass / r2;
                    
                    fx += f * dx / r;
                    fy += f * dy / r;
                    fz += f * dz / r;
                }
            }
            
            // Update velocities
            bodies[i].vx += fx / bodies[i].mass * dt;
            bodies[i].vy += fy / bodies[i].mass * dt;
            bodies[i].vz += fz / bodies[i].mass * dt;
        }
        
        // Update positions
        for (int i = 0; i < n_bodies; i++) {
            bodies[i].x += bodies[i].vx * dt;
            bodies[i].y += bodies[i].vy * dt;
            bodies[i].z += bodies[i].vz * dt;
        }
    }
    
    free(bodies);
}

// Helper function to allocate 2D matrix
double** allocate_matrix(int n) {
    double **matrix = malloc(n * sizeof(double*));
    for (int i = 0; i < n; i++) {
        matrix[i] = malloc(n * sizeof(double));
        // Initialize with random values
        for (int j = 0; j < n; j++) {
            matrix[i][j] = (double)rand() / RAND_MAX;
        }
    }
    return matrix;
}

// Helper function to free 2D matrix
void free_matrix(double **matrix, int n) {
    for (int i = 0; i < n; i++) {
        free(matrix[i]);
    }
    free(matrix);
}

int main() {
    printf("Native profiling test program (Enhanced)\n");
    printf("========================================\n\n");
    srand(time(NULL));
    
    clock_t start, end;
    double cpu_time_used;
    
    // Test 1: Matrix multiplication
    printf("1. Matrix multiplication (%dx%d)...\n", MATRIX_SIZE, MATRIX_SIZE);
    start = clock();
    double **a = allocate_matrix(MATRIX_SIZE);
    double **b = allocate_matrix(MATRIX_SIZE);
    double **c = allocate_matrix(MATRIX_SIZE);
    for (int i = 0; i < ITERATIONS; i++) {
        matrix_multiply(a, b, c, MATRIX_SIZE);
        printf("   Iteration %d/%d completed\n", i+1, ITERATIONS);
    }
    free_matrix(a, MATRIX_SIZE);
    free_matrix(b, MATRIX_SIZE);
    free_matrix(c, MATRIX_SIZE);
    end = clock();
    cpu_time_used = ((double) (end - start)) / CLOCKS_PER_SEC;
    printf("   Time: %.2f seconds\n\n", cpu_time_used);
    
    // Test 2: Prime number calculation
    printf("2. Calculating primes up to %d...\n", PRIME_LIMIT);
    start = clock();
    int prime_count;
    for (int i = 0; i < 3; i++) {  // Run multiple times
        int *primes = calculate_primes(PRIME_LIMIT, &prime_count);
        if (i == 0) printf("   Found %d primes\n", prime_count);
        free(primes);
    }
    end = clock();
    cpu_time_used = ((double) (end - start)) / CLOCKS_PER_SEC;
    printf("   Time: %.2f seconds\n\n", cpu_time_used);
    
    // Test 3: Fibonacci (recursive)
    printf("3. Calculating Fibonacci numbers (recursive)...\n");
    start = clock();
    for (int i = 35; i <= 42; i++) {  // Increased range
        long long fib = fibonacci_recursive(i);
        printf("   fib(%d) = %lld\n", i, fib);
    }
    end = clock();
    cpu_time_used = ((double) (end - start)) / CLOCKS_PER_SEC;
    printf("   Time: %.2f seconds\n\n", cpu_time_used);
    
    // Test 4: Sorting
    printf("4. Bubble sort (%d elements)...\n", SORT_SIZE);
    start = clock();
    int *arr = malloc(SORT_SIZE * sizeof(int));
    for (int i = 0; i < SORT_SIZE; i++) {
        arr[i] = rand() % SORT_SIZE;
    }
    bubble_sort(arr, SORT_SIZE);
    free(arr);
    end = clock();
    cpu_time_used = ((double) (end - start)) / CLOCKS_PER_SEC;
    printf("   Time: %.2f seconds\n\n", cpu_time_used);
    
    // Test 5: String manipulation
    printf("5. String manipulation (50000 iterations)...\n");
    start = clock();
    const char *test_string = "The Quick Brown Fox Jumps Over The Lazy Dog 1234567890";
    char *result = string_manipulation(test_string, 50000);  // Increased iterations
    printf("   Result: %.20s...\n", result);  // Show only first 20 chars
    free(result);
    end = clock();
    cpu_time_used = ((double) (end - start)) / CLOCKS_PER_SEC;
    printf("   Time: %.2f seconds\n\n", cpu_time_used);
    
    // Test 6: Memory stress test
    printf("6. Memory allocation stress test...\n");
    start = clock();
    memory_stress_test(5000);  // Increased iterations
    end = clock();
    cpu_time_used = ((double) (end - start)) / CLOCKS_PER_SEC;
    printf("   Time: %.2f seconds\n\n", cpu_time_used);
    
    // Test 7: Mandelbrot set
    printf("7. Computing Mandelbrot set (800x800)...\n");
    start = clock();
    for (int i = 0; i < 3; i++) {  // Run multiple times
        mandelbrot_set(800, 800);  // Increased resolution
        printf("   Pass %d/3 completed\n", i+1);
    }
    end = clock();
    cpu_time_used = ((double) (end - start)) / CLOCKS_PER_SEC;
    printf("   Time: %.2f seconds\n\n", cpu_time_used);
    
    // Test 8: N-body simulation
    printf("8. N-body simulation (100 bodies, 1000 steps)...\n");
    start = clock();
    nbody_simulation(100, 1000);
    end = clock();
    cpu_time_used = ((double) (end - start)) / CLOCKS_PER_SEC;
    printf("   Time: %.2f seconds\n\n", cpu_time_used);
    
    printf("All tests completed!\n");
    printf("Total estimated runtime: ~60-120 seconds\n");
    return 0;
}