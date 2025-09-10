#include <stdio.h>
#include <unistd.h>

void expensive_loop() {
    double sum = 0;
    for (int i = 0; i < 100000000; i++) {
        sum += i * 0.1;
    }
    printf("Sum: %f\n", sum);
}

void do_work() {
    for (int i = 0; i < 5; i++) {
        printf("Iteration %d\n", i);
        expensive_loop();
        sleep(1);
    }
}

int main() {
    printf("Simple test program\n");
    do_work();
    printf("Done\n");
    return 0;
}