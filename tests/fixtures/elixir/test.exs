#!/usr/bin/env elixir

defmodule Test do
  def calculate_fibonacci(n) when n <= 1, do: n
  def calculate_fibonacci(n) do
    calculate_fibonacci(n - 1) + calculate_fibonacci(n - 2)
  end
  
  def find_primes(limit) do
    Enum.filter(2..limit, fn num ->
      is_prime?(num)
    end)
  end
  
  defp is_prime?(n) when n <= 1, do: false
  defp is_prime?(2), do: true
  defp is_prime?(n) do
    limit = :math.sqrt(n) |> trunc()
    not Enum.any?(2..limit, fn i -> rem(n, i) == 0 end)
  end
  
  def process_data() do
    data = Enum.to_list(0..999)
    
    Enum.reduce(data, 0, fn i, acc1 ->
      Enum.reduce(data, acc1, fn j, acc2 ->
        acc2 + i * j
      end)
    end)
  end
  
  def main() do
    IO.puts("Starting Elixir test...")
    start_time = :os.system_time(:millisecond)
    
    # Ensure we run for at least 250ms
    iterations = run_iterations(start_time, 0)
    
    elapsed = (:os.system_time(:millisecond) - start_time) / 1000
    IO.puts("Completed #{iterations} iterations in #{Float.round(elapsed, 3)} seconds")
  end
  
  defp run_iterations(start_time, count) do
    current_time = :os.system_time(:millisecond)
    
    if current_time - start_time < 1000 do
      calculate_fibonacci(25)  # Increased for more CPU time
      find_primes(500)  # Increased for more CPU time
      process_data()
      run_iterations(start_time, count + 1)
    else
      count
    end
  end
end

Test.main()