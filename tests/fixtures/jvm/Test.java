import java.util.ArrayList;
import java.util.List;

public class Test {
    
    public static int calculateFibonacci(int n) {
        if (n <= 1) {
            return n;
        }
        return calculateFibonacci(n - 1) + calculateFibonacci(n - 2);
    }
    
    public static List<Integer> findPrimes(int limit) {
        List<Integer> primes = new ArrayList<>();
        for (int num = 2; num <= limit; num++) {
            boolean isPrime = true;
            for (int i = 2; i <= Math.sqrt(num); i++) {
                if (num % i == 0) {
                    isPrime = false;
                    break;
                }
            }
            if (isPrime) {
                primes.add(num);
            }
        }
        return primes;
    }
    
    public static long processData() {
        int[] data = new int[1000];
        for (int i = 0; i < data.length; i++) {
            data[i] = i;
        }
        
        long result = 0;
        for (int i = 0; i < data.length; i++) {
            for (int j = 0; j < data.length; j++) {
                if (i < data.length && j < data.length) {
                    result += data[i] * data[j];
                }
            }
        }
        return result;
    }
    
    public static void main(String[] args) {
        System.out.println("Starting Java test...");
        long startTime = System.currentTimeMillis();
        
        // Ensure we run for at least 1000ms
        int iterations = 0;
        while (System.currentTimeMillis() - startTime < 1000) {
            calculateFibonacci(25);  // Increased for more CPU time
            findPrimes(500);  // Increased for more CPU time
            processData();
            iterations++;
        }
        
        double elapsed = (System.currentTimeMillis() - startTime) / 1000.0;
        System.out.printf("Completed %d iterations in %.3f seconds%n", iterations, elapsed);
    }
}