+++
date = 2024-01-23
title = "Encryption in 325 Characters or Less with Bennett!"
+++

What encryption scheme is this?

```python
def e(s,d,r=""):
 p=lambda j,d:53>(k:=d.index(j))and d[:k]+[d[k+1],j]+d[k+2:]
 or[d[0],j]+d[1:k];d=p(54,p(54,p(53,d)));l,h=sorted([d.index(53)
 ,d.index(54)]) d=d[h+1:]+d[l:h+1]+d[:l];b=min(d[-1],53);d=d[b:-1]
 +d[:b]+[d[-1]];o=d[min(d[0],53)];return s and(53>o and e(s[1:],d,
 r+chr(97+(ord(s[0])-97+o)%26))or e(s,d,r))or r
encrypt=e
```

See **Bennett's** post [here](https://andorlando.github.io/static/blogs/golfingwithfelix)!

<!-- more -->

Basically, I was proctoring an informatics tournament to get a free hoodie and
some food, and I bumped into my friend Bennett from high school. Naturally, we decided
to catch up and golf for nine hours straight[^1] a few days later :))

Anyways, the answer is [Solitaire](https://en.wikipedia.org/wiki/Solitaire_(cipher))
from the book _Cryptonomicon_ by Neal Stephenson!

I'll give a quick rundown of the algorithm and then we can get to the interesting
part: golfing, aka writing a program to do a task using the fewest characters.

# Overview

The most important part of the algorithm is generating **keystream values**.
The intention is for these values to be basically random. For each plaintext
character, we add in a keystream value and mod by 26, resulting in a new encrypted
character. For example, if our plaintext letter is "p" (16), and our keystream
value is "k" (11), we would add these to get 27 and mod by 26 to get 1, which
corresponds to "a", our new encrypted value.

So how do we go about making these key stream values? There are roughly 5 steps,
and all you need is a deck of cards. Number the 52 regular cards 1 to 52.
We'll also use the jokers, which we call _A_ and _B_. You can think of them as
cards 53 and 54. Let's walk through the algorithm as we condense this code.
We roughly started with this code for generating keystream values[^2].

# Moving the jokers

The first step is to swap the _A_ joker with the card under
it. If it's the last card, instead place it second from the top.

Representing the deck as a list of integers from 1 to 54, we have the following
helpers:
```python
# get the index of a card
index=lambda l, x: l.index(x)

# push the card at index i down normally
push=lambda l, i: l[:i] + [l[i + 1]] + [l[i]] + l[i + 2:]
```

Combining these two, we have the following to cycle the _A_ joker:

```python
aidx = index(deck, A)
deck = push(deck, aidx) if aidx != DECKSIZE - 1 else (
    [deck[0], deck[aidx], *deck[1:aidx]])
```
The last line handles the edge case where the joker is already on the bottom.
There are already some easy pickings: just shorten the variable names!

```python
# aidx -> a, deck -> d, DECKSIZE - 1 -> 53
a = index(d, A)
d = push(d, a) if a != 53 else (
    [d[0], d[a], *d[1:a]])
```

We can also eliminate some spaces, but let's keep them now for readability.

It's time for our first real optimization: **better ternaries**. This transformation
saves one character per ternary:
```python
x if cond else y
cond and x or y
```

Our final form for Step 1 will then be this for now:
```python
a = index(d, A)
d = a != 53 and push(d, a) or [d[0], d[a], *d[1:a]]
```

The next step is to move the _B_ joker in the same way twice, and this is where
the fun really starts. We have something like:
```python
index=lambda l, x: l.index(x)
push=lambda l, i: l[:i] + [l[i + 1]] + [l[i]] + l[i + 2:]

a = index(d, A)
d = a != 53 and push(d, a) or [d[0], d[a], *d[1:a]]
b = index(d, B)
d = b != 53 and push(d, b) or [d[0], d[b], *d[1:b]]
b = index(d, B)
d = b != 53 and push(d, b) or [d[0], d[b], *d[1:b]]
```

Since the motif `[d[0], d[b], *d[1:b]]` is used so many times, let's put it
in a `lambda`. Let's condense our helpers now:

```python
index=lambda l,x:l.index(x)
push=lambda l,i:l[:i]+[l[i+1]]+[l[i]]+l[i+2:]
cycle=lambda l,i:[l[0],l[b],*l[1:b]]
```
These look pretty small, but all three will turn out to be suboptimal! Notice
in `push` that we wrap two elements in `[]` to turn them into lists and then
concatenate them. This can be better done with a comma:
```python
#                            vvv
push=lambda l,i:l[:i]+[l[i+1]]+[l[i]]+l[i+2:]
#                            v
push=lambda l,i:l[:i]+[l[i+1],l[i]]+l[i+2:]
```

Since these two elements are next to each other in the original list, we tried to
use slicing like: `l[i-1:i+1:-1]`, but this was no better. Let's take a look
at `cycle` now. Firstly, the `*` is suboptimal and we can just use `+`, while
creating a new list for the first two elements:
```python
cycle=lambda l,i:[l[0],l[b],*l[1:b]]
#                v         v
cycle=lambda l,i:[l[0],l[b]]+l[1:b]
```
But it doesn't stop there! We actually can use slicing here. We can actually
slice with a step size of `b-1` to get the `0`th element and the `b`th. Since
`b` is the last index, we won't get any extra elements.
```python
cycle=lambda l,i:[l[0],l[b]]+l[1:b]
cycle=lambda l,i:l[0:b+1:b]+l[1:b]
```
But it gets even better! We can actually just omit the indices:
```python
cycle=lambda l,i:[l[0],l[b],*l[1:b]]
cycle=lambda l,i:l[::b]+l[1:b]
```
And we've not eliminated a full **5** characters from `cycle`! This is actually
pretty massive.

Notice how both `cycle` and `push` take an index? We can save some space by only having
that parameter occur once, if we fuse the two functions into one that takes the joker as
a parameter and moves it:
```python
#             vvvvvvvvv                  v 
p=lambda j:53>(k:=i(j))and d[:k]+[d[k+1],j]+d[k+2:]or d[::k]+d[1:k]
```

We also introduce the **walrus operator** to cache the result of a computation
while inside an expression. `(x:=expr)` evaluates to `expr`, and _also_ defines
the binding `x`. Super useful, as we can now use `i(j)` in multiple places without
writing it out. Also notice that we replace `d[k]` with `j`, since `k` is by definition
the index of `j`. Instead of using checking if the joker index is `!= 53`,
we check if it's `< 53`, saving one character. Finally, we've also eliminated the
`l` parameter, and just use the global variable `d` which represents the deck.

Now, all it takes to move the jokers is:
```python
i=lambda x:d.index(x)
p=lambda j:53>(k:=i(j))and d[:k]+[d[k+1],j]+d[k+2:]or d[::k]+d[1:k]
# A = 53, B = 54
d=p(A)
d=p(B)
d=p(B)
```

We were really happy with this `push` function. It's just so compactified and \*mwah\*
chef's kiss.

# Part Two: Cuts

The next step is to perform a triple cut. This is best explained visually. Suppose our deck looks
like this (with some cards omitted): 1 2 3 _A_ 4 5 6 _B_ 7 8 9. We just swap
the portions to the _outsides_ of the jokers, so we get 7 8 9 _A_ 4 5 6 _B_ 1 2 3.
Notice that the jokers don't move, nor do the cards between them.

We first to figure out which joker is to the left (low), and which one is to the
right (high)[^3]. We started by just using python's `sorted` function, like this:
```python
l, h = sorted([i(A), i(B)])
d = [*d[h+1:], *d[l:h + 1], *d[:l]]
```
Since `sorted` seems kinda long, we also tried some other methods for ordering the
two joker indices. One failed (but cool) attempt uses xor:
```python
a=i(A)
b=i(B)
l=min(a,b)
h=l^a^b
```
but it's still quite a fair bit longer. Let's compress and improve the main triple
cutting action now. Once again, we immediately ditch the stars:
```python
d=[*d[h+1:],*d[l:h+1],*d[:l]]
d=d[h+1:]+d[l:h+1]+d[:l]
```
And honestly, that's about as short as we could get the triple cut.

The next cut is a count cut. Look at the bottom card of the deck, and move that
many cards from the top to just above it. Count the jokers as having value 53.
Here's an example
```
vvvvvvvvvvv last card is 5, so we move the top 5 cards
[2 4 6 8 1] 3 5 -> 3 [2 4 6 8 1] 5
```
The code to execute this cut is also pretty simple (`b` means bottom):
```python
b = min(d[-1], A)
d = [*d[b:-1], *d[:b], d[-1]]
```
We have to `min` the bottom card with the value of the _A_ joker, since
we also want to count the _B_ joker as 53. Let's quickly eliminate the stars,
saving one character:
```python
d=[*d[b:-1],*d[:b],d[-1]]
d=d[b:-1]+d[:b]+[d[-1]]]
```
Now Bennett was thinking, what if we don't take the `min`, and pretend the deck is
53 cards long, then just add back the last card at the end? Doing this, we can
eliminate quite a few characters!
```python
b=min(d[-1],A)
d=[*d[b:-1],*d[:b],d[-1]]

b=d[-1]
d=d[b:-1]+d[:-1][:b]+[b]
#                    ^^^
```
Since we now have `b` _defined_ as `d[-1]`, we can replace the last term with `b`!
Now both lines are shorter! This was pretty sick.

# Extracting the Keystream Value

Finally, we just use the value of top card as an index. If it's not a joker, we
return the deck at that index, otherwise, we recurse and execute the entire
keystream procedure again. In other characters:
```python
t=min(d[0],A)
return d[t]<A and d[t]or keystream()
```

Our program now looks like this (with some omissions for clarity):
```python
i=lambda x:d.index(x)
p=lambda j:53>(k:=i(j))and d[:k]+[d[k+1],j]+d[k+2:]or d[::k]+d[1:k]

def keystream():
    global d, A, B
    d=p(A)
    d=p(B)
    d=p(B)

    # triple cut
    lo,hi=sorted([i(A),i(B)])
    d=d[hi+1:]+d[lo:hi+1]+d[:lo]

    # count end
    b=min(d[-1],A)
    d=d[b:-1]+d[:b]+[d[-1]]

    # return value
    t=min(d[0],A)
    return d[t]<A and d[t]or keystream()
```

Quite a bit shorter!

# Actual Encryption

To encrypt some text, we now have to combine the keystream and plain text. We
started with:
```python
for c in "<text>":
    enc = 96 + ((ord(c) - 96 + keystream()) % 26 or 26)
    result += chr(enc)
```
Note that 96 is 1 less than the ASCII value of 'a'. This snippet also has a bug!
If our plaintext + keystream is 0 mod 26, we'll get `chr(96) = 'z'`. We can
fix this easily by using 97 instead of 96 as our offset. With that out of the
way, we can now define a nice `encrypt` function:

```python
encrypt=lambda s:"".join(chr(97+(ord(c)-97+k())%26)for c in s)
```

At this point, we were at just under 350 characters, IIRC, but we still wanted
to do better. There were a few small changes, like adding and deleting some
variables, but our biggest concerns were the `return` and `global` keywords used
in our keystream function.

# Functional Programming

For some reason, a few days before, I had implemented this algorithm in Haskell.
Since Haskell is _purely functional_, it has no mutation, so global variables
are obviously out of style. Sort of vibing off of this, I thought maybe we could
do some multiparameter tail-recursive fold stuff to update the state of the deck
between calls to keystream. And it turns out you can! The basic idea is to
produce the new inputs to the encrypt function while encrypting a character.

The Haskelly way to do things would be something like this
```python
encrypt(string, deck) =
#  v encrypt character                   v recursively encrypt the rest
   combine(string[0], keystream(deck)) + encrypt(string[1:], newdeck)
#                                      ^ combine the two parts
```

where the keystream function returns the new deck! We basically set up a
function signature like this:
```
encrypt(string, deck, encrypted) -> string
```
and reverse engineered it. I'll just show what the result is:

```python
def e(s,d,t=""):
    # move jokers
    d=p(54,p(54,p(53,d)))
    # triple cut
    l,h=sorted([d.index(53),d.index(54)])
    d=d[h+1:]+d[l:h+1]+d[:l]
    # count cut
    b=d[-1]
    d=d[b:-1]+d[:-1][:b]+[b]
    # get the keystream value, or "offset"
    o=d[d[0]%54or-1]
    # nested ternary madness
    return s and (
            o<53 and e(s[1:],d,t+chr((ord(s[0])-97+o)%26+97))
                 or e(s,d,t)
           ) or t
encrypt=e
```

Firstly, we define `e` so that we can recurse without having to pay the cost
of typing out `encrypt`, then just "rename" it to `e` at the end.

The parameter `s` represents the input string, `d` represents the deck, and
`t` ... I don't remember why it's called that ... is our encrypted text. I think
we wanted to call it `e` for encryption but that wasn't an option.

Ok, so this ternary monster. First, we check if `s` is empty. If it is, it's
falsy so we'll take the second branch and return `t`, or the fully encrypted
string. Otherwise, we go into the second ternary.

Here, we check if the keystream value was a joker. It it was, we recurse with
the same `s` and `t`, since we haven't gotten a valid keystream value, but
notice that `d` has changed. If we do have a valid keystream value, we recurse
on the string with the first character chopped off, our new deck, and an
encrypted string with one character freshly added.

Altogether this somehow saved **12** characters! I have no idea how, but it's
elegant and arcane and completely inscrutable so I love it.

That's basically it! There were probably some other small optimizations we did
that aren't worth covering here. Overall, it's so satisfying just seeing the code
shrink and shrink. You should give golfing a try :)

Check out Bennett's [blog](https://andorlando.github.io/static/blogs/index) for
his writeup and [GitHub](https://github.com/andOrlando) for other insane
code he's written.

And lastly, you can see the code in its full glory on
[GitHub](https://github.com/PontifexEncrypt/Pontifex/blob/main/solitaire-golf-fprasx.py)
and right here:
```python
p=lambda j,d:53>(k:=d.index(j))and d[:k]+[d[k+1],j]+d[k+2:]or d[::k]+d[1:k]
def e(s,d,t=""):d=p(54,p(54,p(53,d)));l,h=sorted([d.index(53),d.index(54)]);d=d[h+1:]+d[l:h+1]+d[:l];b=d[-1];d=d[b:-1]+d[:-1][:b]+[b];o=d[d[0]%54or-1];return s and(o<53and e(s[1:],d,t+chr((ord(s[0])-97+o)%26+97))or e(s,d,t))or t
encrypt=e
```

Thanks for reading, and I'll see you next time!

[^1] Ok I lied; there was a small burrito break.

[^2] Starter code
```python
index=lambda l, x: l.index(x)
push=lambda l, i: l[:i] + [l[i + 1]] + [l[i]] + l[i + 2:]

def keystream():
    global deck, A, B, DECKSIZE
    # cycle ajoker
    aidx = index(deck, A)
    deck = push(deck, aidx) if aidx != DECKSIZE - 1 else (
        [deck[0], deck[aidx], *deck[1:aidx]])

    # cycle bjoker
    bidx = index(deck, B)
    deck = push(deck, bidx) if bidx != DECKSIZE-1 else (
        [deck[0], deck[bidx], *deck[1:bidx]])

    bidx = index(deck, B)
    deck = push(deck, bidx) if bidx != DECKSIZE-1 else (
        [deck[0], deck[bidx], *deck[1:bidx]])

    # triple cut
    [lo, hi] = sorted([index(deck, A), index(deck, B)])
    deck = [*deck[hi+1:], *deck[lo:hi + 1], *deck[:lo]]

    # count end
    bot = min(deck[-1], A)
    deck = [*deck[bot:-1], *deck[:bot], deck[-1]]

    # return value
    top = min(deck[0], A)
    return deck[top] if deck[top] < A else keystream()
```

[^3] I just realized this is contratry to our intuition about a face down deck.
The first card is the highest.
