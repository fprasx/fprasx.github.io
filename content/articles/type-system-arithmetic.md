+++
title = "Doing First Grade Math in Rust's Type System"
date = 2024-01-04
+++

Arithmetic is hard. Luckily, we can fix that using Rust's Expressive Type
System™️.

<!-- more -->

### Math

Let's start with Church Encodings. There's
this idea in functional programming that functions are good, and type theorists
took it pretty far. So far that they sometimes define numbers as functions that
look like this:

```
0 = |f, x| x                             # f applied 0 times
1 = |f, x| f(x)                          # f applied 1 times
2 = |f, x| f(f(x))                       # f applied 2 times
3 = |f, x| f(f(f(x)))                    # f applied 3 times
...                                      # f applied . times
n = |f, x| f( .. n - 2 more f's .. f(x)) # f applied n times
```

The nth natural number is _literally_ defined as a function that takes a
value and function, and applies that function n times.

There's another concept from math called the Peano Axioms. It's also an
Extremely Useful way to characterize the natural numbers that is basically as
follows (omitting some details):

```
0. 0 is a natural number.
1. The successor, S(n), of a natural number is a natural number.
```

This inductively defines the natural numbers as:

```
0 = 0
1 = S(0)
2 = S(1) = S(S(0))
3.= S(2) = S(S(S(0)))
...
n = S( .. n - 2 more S's .. S(0))
```
where `S` is called the Successor Function. It doesn't really matter what it
actually is, since we're going for a more . . . abstract view of things.

Notice any similarity to the Church Encodings?

The main idea is that we can represent a number as a *repeated function
application*.

### Enter Rust

So how do we replicate this in Rust? And how do we make it performant? We
could just do it using regular lambdas, but that would probably be slow since
closures are boxed, etc, etc.

The ultimate strategy is to play God and compute our numbers at compile time!
After all, that's the Rust way. But how do we call functions at compile time?
Well, we can borrow another idea from type theory, and notice that a generic
struct is sort of like a function. Consider:
`struct Wrapper<T>(PhantomData<T>)`. Instantiating `T` is sort of like computing
a function on types, starting with a type `T` and ending with a type
`Wrapper<T>`. And one could conceivably construct a type
`Wrapper<Wrapper<Wrapper<T>>>` . . . 

I bet this is starting to get repetitive. Let's define the following types:
```rust
struct Zero;
struct Succ<T>(PhantomData<T>);
```

Yeah I know `Succ` sounds like a funny word, but it's really just convention for
`Successor`. We can now define some natural numbers:
```rust
type One = Succ<Zero>;
type Two = Succ<Succ<Zero>>;
type Three = Succ<Succ<Succ<Zero>>>;
...
```

This is going to get annoying. Let's write a little macro to help us out:
```rust
#[macro_export]
macro_rules! encode {
    () => {
        Zero
    };
    ($_a:tt $($tail:tt)*) => {
        Succ<encode!($($tail)*)>
    };
}
```

Basically, we feed this bad boy tokens, and it'll gobble them up one at a time,
each time adding a new layer of `Succ` to the type it's constructing. Here's
an example expansion:

```rust
  encode!(* ***)
            ^ these tokens correspond to $tail
= Succ<encode!(* **)>
= Succ<Succ<encode!(* *)>>
= Succ<Succ<Succ<encode!(*)>>>
= Succ<Succ<Succ<Succ<encode!()>>>>
                      ^ input is empty, so encode!() expands to Zero
= Succ<Succ<Succ<Succ<Zero>>>>
```

Now we can construct decently large numbers using `encode!(***** ... *****)`,
although the compiler will overflow its stack at about 3200 tokens due to 
recursion.

### Evaluation

Now, remember, we're trying to do arithmetic with these numbers, so we need
to be able to extract them out of this encoded form at some point. Hopefully,
we can do all our computation at compile time (so infinitely fast?) and then
extract them as constants into our final binary. This means we need a function
from types to . . . values? Hmm. Well, if you look at them hard enough, traits
are kind of like functions from types to values.

```rust
trait SpecialNumber {
    const MAGIC: usize;
}

impl SpecialNumber for Foo {
    const MAGIC: usize = 13;
}

impl SpecialNumber for Bar {
    const MAGIC: usize = 29;
}
```

In a sense, we've mapped the type `Foo` to `13`, and the type `Bar` to 29. Let's
keep going with this idea and define the `Value` trait:

```rust
trait Value {
    const VALUE: usize;
}

impl Value for Zero {
    const VALUE: usize = 0;
}

impl<T> Value for Succ<T> where T: Value {
    const VALUE: usize = 1 + T::VALUE;
}
```

We can now recursively "evaluate" a type - or get how many time's `Succ` has
been applied, since the second case strips off one `Succ` layer each iteration.

### Addition and Subtraction

Alright, we're on to something a little juicier. The main idea is still the
same though. We'll use this weird type recursion to construct new types. Instead
of using traits to map types to values, we can also use them to map types to
other types, using associated constants. Let's define the trait `Add` like so:

```rust
trait Add {
    type Sum;
}
```

We can now define some base cases for our recursion:

```rust
impl Add for (Zero, Zero) { // 0 + 0 = 0
    type Sum = Zero;
}

impl<T> Add for (Succ<T>, Zero) { // x + 0 = x
    type Sum = Succ<T>;
}

impl<T> Add for (Zero, Succ<T>) { // 0 + x = x
    type Sum = Succ<T>;
}
```

And now for our recursive rule:

```rust
impl<T, U> Add for (Succ<T>, Succ<U>)
where
    (T, Succ<Succ<U>>): Add,
{
    type Sum = <(T, Succ<Succ<U>>) as Add>::Sum;
}
```

Let's break it down. We firstly are taking two nonzero numbers - since both
type parameters are wrapped in `Succ`, and could also be `Succ<..>` themselves.
The idea of this rule is to take one layer of `Succ` off of the first type
parameter, and stick it on the other. Then eventually, the second type parameter
will have all the `Succ`'s - precisely the total number of `Succ`'s that they
both started with, which means it represents the sum of the two starting
numbers. Let's do a small example (I won't do this for all of them):

```
  Add<Succ<Succ<Zero>>, Succ<Succ<Zero>>>
= Add<Succ<Zero>, Succ<Succ<Succ<Zero>>>> // move one Succ to the right
= Add<Zero, Succ<Succ<Succ<Succ<Zero>>>>> // again
= Succ<Succ<Succ<Succ<Zero>>>>>           // base case :)
```

Finally, there are also some trait bounds - we're telling rustc we'll only
call this trait (weird idea right?) on types that can be added.

Subtraction is pretty similar (division is where it really goes crazy). We
define our base cases:

```rust
trait Sub {
    type Diff;
}

impl Sub for (Zero, Zero) { // 0 - 0 = 0
    type Diff = Zero;
}

impl<T> Sub for (Succ<T>, Zero) { // x - 0 = x
    type Diff = Succ<T>;
}

impl<T> Sub for (Zero, Succ<T>) { // 0 - x = 0, we'll saturate
    type Diff = Zero;
}
```

The only interesting thing here is that we define subtraction as _saturating_.
This will help with implementing division. If you leave out that rule 
completely, the compiler will actually prevent you from having underflows!

Anyways, here's our recursive rule:

```rust
impl<T, U> Sub for (Succ<T>, Succ<U>)
where
    (T, U): Sub,
{
    type Diff = <(T, U) as Sub>::Diff;
}
```

We basically just peel one layer of `Succ` off of each type parameter until one
of them is zero. The remaining one is then our difference. You can think about
it pictorially as this:
```
5 [***] **
-
3 [***]
=
2 [   ] **
```
where we got rid of the shared terms in the brackets one at a time.

# Multiplication

Ok, this task is a bit more complex, but we can use our building blocks from
before. As always, we define a trait-function and some base cases:

```rust
trait Mul {
    type Product;
}

impl<T> Mul for (T, Zero) { // x * 0 = 0
    type Product = Zero;
}

impl<T> Mul for (Zero, Succ<T>) { // 0 * x = 0
    type Product = Zero;
}
```

We now have to be a little more careful with what we implement `Mul` for. If
we were to do the second implementation on `(Zero, T)`, then we would have
two implementations covering `(Zero, Zero)`. Thus, we implement it on
`(Zero, Succ<T>)`, since `Succ<T>` is never equal to `Zero`. And now for the
recursion, we have this baby monstrosity:

```rust
impl<T, U> Mul for (Succ<T>, Succ<U>)
where
    (T, Succ<U>): Mul,
    (Succ<U>, <(T, Succ<U>) as Mul>::Product): Add,
{
    type Product = <(
        Succ<U>,                       // y
        <(T, Succ<U>) as Mul>::Product // (x - 1) * y
    ) as Add>::Sum;
}
```

Here, we're using the fact that `x * y = y + (x - 1) * y`. We recursively
calculate the second term, and then add it to the first factor!. Remember that
if `Succ<T>` represents `T + 1`, then `T` represents `Succ<T> - 1`.

And finally . . .

### Division

I won't lie, this one really is a monstrosity. We'll first need to define
`GreaterThanEq` to check if `x >= y`, since some divisions aren't clean, e.g.
`7 / 3`. I'll explain more later. We'll do this similarly to how we did
`Subtraction`:
```rust
trait GreaterThanEq {
    type Greater;
}

impl GreaterThanEq for (Zero, Zero) { // 0 >= 0
    type Greater = Succ<Zero>;
}

impl<T> GreaterThanEq for (Zero, Succ<T>) { // 0 >!= { 1 .. }
    type Greater = Zero;
}

impl<T> GreaterThanEq for (Succ<T>, Zero) { // { 1 .. } >= 0
    type Greater = Succ<Zero>;
}

impl<T, U> GreaterThanEq for (Succ<T>, Succ<U>)
where
    (T, U): GreaterThanEq, // x >= y -> x - 1 >= y - 1
{
    type Greater = <(T, U) as GreaterThanEq>::Greater;
}
```

With that out of the way, let's handle division. We'll first start with 
perfect quotients, like `6 / 3`. Here's our boilerplate:
```rust
trait Div {
    type Quotient;
}

impl<T> Div for (Zero, T) { // 0 / x = 0
    type Quotient = Zero;
}

impl<T> Div for (Succ<T>, Succ<Zero>) { // x / 1 = x
    type Quotient = Succ<T>;
}
```

Once again, we have to be careful with our type arguments. Instead of
doing the second implementation on `(T, Succ<Zero>)`, we implement it on
`(Succ<T>, Succ<Zero>)` to avoid overlapping with the first implementation on
`(Zero, Succ<Zero>)`. We can now make use of the identity
`x / y = 1 + (x - y) / y`. Intuitively, this means we just take one copy of
`y` out of `x`, and then count the rest recursively. In code, it looks like:

```rust
type RawQuotient<T, U> = <(
    Succ<Zero>, // 1
    <(
        <(Succ<T>, Succ<Succ<U>>) as Sub>::Diff,
        Succ<Succ<U>> 
    ) as Div>::Quotient, // (x - y) / y
) as Add>::Sum;
```

The only problem is that this expression is incorrect if `x < y`, and will
return 1. The subtraction saturates to 0, so we get `1 + 0 / y = 1 + 0 = 1`.

We just need to combine this `RawQuotient` with the fact that
`x / y` is  0 if `x < y`. Since we have this number as a boolean, we can do a
trick for replacing a conditional jump with a multiplication (or a cmov in
assembly). Observe the following table:

```
   Case       Boolean of Gte       RawQuotient       Desired
+--------+  +----------------+   +-------------+   +---------+ 
| x >= y |: |       1        | x |   nonzero   | = | nonzero |
+--------+  +----------------+   +-------------+   +---------+ 
| x < y  |: |       0        | x |     ???     | = |    0    |
+--------+  +----------------+   +-------------+   +---------+ 
```

We can just multiply our `RawQuotient` by whether `x >= y`! If `x >= y`, we'll
be left with our `RawQuotient`. If `x < y`, we'll be multiplying by 0 and get
0 no matter what, as desired. This leads to the final form of division:
```rust
impl<T, U> Div for (Succ<T>, Succ<Succ<U>>)
where
    (T, Succ<U>): Sub,
    (<(T, Succ<U>) as Sub>::Diff, Succ<Succ<U>>): Div,
    (
        Succ<Zero>,
        <(<(T, Succ<U>) as Sub>::Diff, Succ<Succ<U>>) as Div>::Quotient,
    ): Add,
    (
        <(Succ<T>, Succ<Succ<U>>) as GreaterThanEq>::Greater,
        <(
            Succ<Zero>,
            <(<(T, Succ<U>) as Sub>::Diff, Succ<Succ<U>>) as Div>::Quotient,
        ) as Add>::Sum,
    ): Mul,
    (Succ<T>, Succ<Succ<U>>): GreaterThanEq,
{
    // Hi I'm the important part
    type Quotient = <(
        <(Succ<T>, Succ<Succ<U>>) as GreaterThanEq>::Greater,
        RawQuotient<T, U>,
    ) as Mul>::Product;
}
```

We have a bunch of trait bounds because we have a bunch more subexpressions we
need to make sure are evaluatable. At the end of the day though, all this
basically comes down to is only passing in chains of `Succ` with a `Zero` at the
bottom.

You also might notice that we're implementing the recursive case of `Div` on
`(Succ<T>, Succ<Succ<U>>)`. This means the denominator is greater than 1, so it
doesn't overlap with any other implementation.

In true Rust fashion, this implementation actually won't allow us to divide by
0, since we never implemented `Div` for `(*, Zero)`!

And somewhat anticlimactically . . . that's it! I don't know how to convey the
elation of little green test case dots passing, so you can run it yourself
by getting the code from 
[Arithmetic in Rust's Type System](https://github.com/fprasx/arts), or arts for
short.

# Note

I should note I'm not the first person to do this - although I thought I
might have been when I first started haha. For prior art, see the
[typenum](https://crates.io/crates/typenum) and
[peano](https://crates.io/crates/peano) crates. `typenum` is much faster and is
what you would actually use in practice.

Once again, I highly recommend running the
[code](https://crates.io/crates/peano) for yourself. It's a really cool feeling
seeing these abstract traits materialize into numbers on your terminal.
Feel free to drop a star as well!

That's it for me. Have a nice day :)
