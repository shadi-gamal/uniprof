using System;
using System.Collections.Generic;

public class Test
{
    public static int CalculateFibonacci(int n)
    {
        if (n <= 1)
        {
            return n;
        }
        return CalculateFibonacci(n - 1) + CalculateFibonacci(n - 2);
    }
    
    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    public static List<int> FindPrimes(int limit)
    {
        var primes = new List<int>();
        for (int num = 2; num <= limit; num++)
        {
            bool isPrime = true;
            for (int i = 2; i <= Math.Sqrt(num); i++)
            {
                if (num % i == 0)
                {
                    isPrime = false;
                    break;
                }
            }
            if (isPrime)
            {
                primes.Add(num);
            }
        }
        return primes;
    }
    
    public static long ProcessData()
    {
        int[] data = new int[1000];
        for (int i = 0; i < data.Length; i++)
        {
            data[i] = i;
        }
        
        long result = 0;
        for (int i = 0; i < data.Length; i++)
        {
            for (int j = 0; j < data.Length; j++)
            {
                if (i < data.Length && j < data.Length)
                {
                    result += data[i] * data[j];
                }
            }
        }
        return result;
    }
    
    public static void Main(string[] args)
    {
        Console.WriteLine("Starting C# test...");
        var startTime = DateTime.Now;
        
        // Ensure we run for at least 1000ms
        int iterations = 0;
        while ((DateTime.Now - startTime).TotalMilliseconds < 1000)
        {
            CalculateFibonacci(25);  // Increased for more CPU time
            FindPrimes(500);  // Increased for more CPU time
            ProcessData();
            iterations++;
        }
        
        double elapsed = (DateTime.Now - startTime).TotalSeconds;
        Console.WriteLine($"Completed {iterations} iterations in {elapsed:F3} seconds");
    }
}