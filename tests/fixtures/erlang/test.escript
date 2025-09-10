#!/usr/bin/env escript
%%! -pa .

-module(test).
-export([main/1]).

calculate_fibonacci(0) -> 0;
calculate_fibonacci(1) -> 1;
calculate_fibonacci(N) -> 
    calculate_fibonacci(N - 1) + calculate_fibonacci(N - 2).

find_primes(Limit) ->
    lists:filter(fun(N) -> is_prime(N) end, lists:seq(2, Limit)).

is_prime(N) when N =< 1 -> false;
is_prime(2) -> true;
is_prime(N) ->
    Limit = trunc(math:sqrt(N)),
    not lists:any(fun(I) -> N rem I == 0 end, lists:seq(2, Limit)).

process_data() ->
    Data = lists:seq(0, 999),
    lists:foldl(fun(I, Acc1) ->
        lists:foldl(fun(J, Acc2) ->
            Acc2 + I * J
        end, Acc1, Data)
    end, 0, Data).

run_iterations(StartTime, Count) ->
    CurrentTime = erlang:system_time(millisecond),
    if
        CurrentTime - StartTime < 1000 ->
            calculate_fibonacci(25),  %% Increased for more CPU time
            find_primes(500),  %% Increased for more CPU time
            process_data(),
            run_iterations(StartTime, Count + 1);
        true ->
            Count
    end.

main(_Args) ->
    io:format("Starting Erlang test...~n"),
    StartTime = erlang:system_time(millisecond),
    
    %% Ensure we run for at least 250ms
    Iterations = run_iterations(StartTime, 0),
    
    Elapsed = (erlang:system_time(millisecond) - StartTime) / 1000,
    io:format("Completed ~p iterations in ~.3f seconds~n", [Iterations, Elapsed]).