export const SAMPLE_PROGRAM = `# Sample: print "Hello, world!" then sum 1..10
        .data
hello:  .asciiz "Hello, world!\\n"
sumMsg: .asciiz "Sum 1..10 = "
nl:     .asciiz "\\n"

        .text
main:
        li   $v0, 4
        la   $a0, hello
        syscall

        li   $t0, 1        # i = 1
        li   $t1, 0        # sum = 0
loop:
        bgt  $t0, 10, done
        add  $t1, $t1, $t0
        addi $t0, $t0, 1
        b    loop
done:
        li   $v0, 4
        la   $a0, sumMsg
        syscall

        li   $v0, 1
        add  $a0, $t1, $zero
        syscall

        li   $v0, 4
        la   $a0, nl
        syscall

        li   $v0, 10
        syscall
`;
