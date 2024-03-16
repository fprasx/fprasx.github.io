+++
title = "Demystifying the Trustfall Query Engine"
date = 2024-01-29
+++

The Trustfall Engine claims to be able to "query anything". What does that mean?

<!-- more -->
<!-- TODO: second article -->
This blog post will mainly explain the intuition and
"theory" behind Trustfall, while a separate blog post will cover a breakdown and
guide of a real project I'm working on.

You may have heard that Trustfall is the query engine that powers `cargo-semver-checks`,
a tool that checks for semantic versioning violations between different versions of
crates. It does this by finding discrepancies between the `rustdoc` JSON output
for different versions of a crate. In essence, it can "query" the `rustdoc`
output and ask questions about it, like "was there any type where a public field was
removed?".

So how does Trustfall "understand" the `rustdoc` output? The short answer is that
Trustfall understands everything as a directed _graph_, and we can allow it to "understand"
our data by defining what the _vertices_ and _edges_ are in this graph.

# Some Philosophizing About Graphs

Vertices in a graph often represent objects, people, or distinct items, while edges
denote _relations_ between two of these things. For example, a vertex from person
A to person B in the graph might mean that person A follows person B on GitHub.
So we might call the relation the edge represents a "follows relation".
In general, an edge "points" us from one vertex to another, suggesting a structured
way we can traverse this graph, for example {Depth,Breadth}-First Search.

Trustfall understands graphs in a similar way, and we provide it a description of
our data graph using a GraphQL schema. Trustfall thinks of each different data type
in this schema as a vertex. For example, these two types corresponding to the API
data for a `trait` and `struct` would be different vertices:

```graphql
type Trait {
    visibility: Boolean,
    associated_types: [Type],
    associated_fns: [Function]
}

type Struct {
    visibility: Boolean,
    fields: [StructField]
}
```

Then what is the relation between vertices in this graph? It's just: if type A
contains type B as a field, then there is an edge from A to B. Intuitively, we
can think of there being an edge from A to B if Trustfall can get B's data by
"crossing the edge" from A. In the previous example, the `Struct` type has an edge pointing
to the `StructField` type, because it contains a field of type `[StructField]`.
We can imagine that if Trustfall wanted to enumerate all `Struct` fields, it would
first enumerate all `Struct`s, then follow each `Struct -> StructField` edge to
enumerate each `StructField`. In other words, given a `Struct`, Trustfall can
query some `StructField` data.

Finally, Trustfall also has something called properties. These are
edges that point to primitive types - almost like edges that lead to a leaf vertex
in a tree. Some examples of primitive types would be `String` or `Integer`. The
"edge" `shaved` here is an example of a property:

```graphql
type Yak {
    shaved: Boolean!
}
```

# The Big Question?

So can Trustfall query everything? I would say "basically", since almost anything can
be modelled as a graph - filesystems, databases, data from many Rust programs[^1].

# Improvise, _Adapt_, Overcome

Now that we have a loose understanding of Trustfall's brains, we now need
to understand the Trustfall data model. Trustfall represents data as the following
enum:
```rust
#[non_exhaustive]
pub enum FieldValue {
    Null,
    Int64(i64),
    Uint64(u64),
    Float64(f64),
    String(Arc<str>),
    Boolean(bool),
    Enum(Arc<str>),
    List(Arc<[FieldValue]>),
}
```
Our job is to convert this data, whether it be normal Rust data stored in
structs and enums, some data on another server, or serialized data, _into_ this
format.

The way we actually give data to Trustfall is through an `Adapter`, which gives
Trustfall a structured way of "asking" for data. More precisely, this means that
Trustfall specifies some data using, say, the name of a property on a specific
type of vertex, and we then convert that data from whatever "natural" form we have
it in into `FieldValue`. Note that we can get this data however we want: we might
need to make an API request before giving it to Trustfall, access a database, or
decrypt a file. This flexibility is part of what makes Trustfall so powerful. _You_
choose how you want to give Trustfall the data. The constraints on its form are
extremely loose. It basically just needs to be serializable into `FieldValue`.

The actual API for this data handoff is defined in a trait called, you guessed it,
[`Adapter`](https://docs.rs/trustfall/latest/trustfall/provider/trait.Adapter.html).
We implement this trait for an adapter type, and then give Trustfall the adapter.
It can then call methods in the Adapter trait to get the data it needs.

Instead of implementing Adapter, you can intead implement
[`BasicAdapter`](https://docs.rs/trustfall/latest/trustfall/provider/trait.BasicAdapter.html)
which is a simpler process but almost as powerful[^2]. Under the hood, implementing
`BasicAdapter` implements `Adapter` for you, but just gives you a little less control
over optimizations.

Since I've only ever used `BasicAdapter`, let's look at that.

# Vertices in Practice

The first item in the trait is an associated type:

```rust
type Vertex: Typename + Clone + Debug + 'vertex;
```

This is pretty straightforward - all it's saying is that our vertex type needs
to be clonable, printable with `:?`, and
[`Typename`](https://docs.rs/trustfall/latest/trustfall/provider/trait.Typename.html),
which means that we can get which type of vertex it is as a `&'static str` (this
is used internally in Trustfall). Since this trait is so simple, I'll just show it here:
```rust
pub trait Typename {
    fn typename(&self) -> &'static str;
}
```

Since we have multiple vertex _variants_ (wink), it's convenient to model our vertices
as an enum. You can `derive` the `TrustfallEnumVertex` trait for an enum, which
will add `as_*` methods for each enum to "unwrap" into that variant (useful
when implementing adapters), as well as automatically implement `Typename`.

This all leaves us to ask: which should the first vertices we search be?

# Where to Start the Search?

It's up to you, and you can communicate this to Trustfall through the first
required method for `BasicAdapter`, `resolve_starting_vertices`:

```rust
fn resolve_starting_vertices(
    &self,
    edge_name: &str,
    parameters: &EdgeParameters
) -> Box<dyn Iterator<Item = Self::Vertex> + 'vertex>;
```

Given the parameters, this function is now pretty clear. `self` is just the
adapter, `edge_name` is an edge that we will traverse to get the first vertices.
I have actually never used `parameters`, but my impression is that they allow
you to store some extra information when traversing an edge. They could inform
your decision to do a filter or perform an optimization.

You can think of this function as providing Trustfall the "root" data that all
future parts of the query will derive data their from, in other words, the starting
vertices of your graph traversal.

# I Want your Property

The next method is `resolve_property`, which just does what it says on the
tin. Given a vertex, it asks for the value of a property of that vertex, like so:

```rust
fn resolve_property<V: AsVertex<Self::Vertex> + 'vertex>(
    &self,
    contexts: ContextIterator<'vertex, V>,
    type_name: &str,
    property_name: &str,
) -> ContextOutcomeIterator<'vertex, V, FieldValue>;
```

There's a bit more to unpack here. Firstly, `self` is the same as before.
`contexts` is an iterator of `DataContext`, which is a partially evaluated
Trustfall query. `type_name` is the type of vertex that Trustfall wants a property
of, and `property_name` is that property.

`contexts` is important because each `DataContext` has an **active** vertex,
which represents where in the graph Trustfall is at the moment. Since some vertices
may be optional, this active vertex can be `None`. The idea of this method is
that during a query, Trustfall has a series of partially evaluated queries at
some vertex in the data graph. For each context, Trustfall observes the type of
the active vertex, figures out which properties it needs, and then calls
```rust
adapter.resolve_property(contexts, type_name, property_name)
```
for each property it needs.

I hope this motivates why `resolve_property` has the signature it has. The
next function, `resolve_neighbours`, has a similar flavour.

# Who are you Neighbors?

Here's what we're working with:

```rust
fn resolve_neighbors<V: AsVertex<Self::Vertex> + 'vertex>(
    &self,
    contexts: ContextIterator<'vertex, V>,
    type_name: &str,
    edge_name: &str,
    parameters: &EdgeParameters,
) -> ContextOutcomeIterator<'vertex, V, VertexIterator<'vertex, Self::Vertex>>;
```

Once again, we have a set of contexts to evaluate this "request" in, nothing
new. We now also have `type_name` and `edge_name` - this is the core of the
request. Trustfall is asking, "I'm at a vertex of type `type_name`, could
I have all the edges of type `edge_name`?"

I'm going to ignore the edge parameters since those don't influence the intuition
behind this query (and I've never used them 😉).

# Coercion

The next method is a little tricker and requires some more knowledge of
GraphQL syntax. If you've used TypeScript, what I'm about to explain should seem
very familiar. Let's begin with an `interface`, which specifies a set of edge names
that an implementer should have, like so:

```graphql
interface TreeNode {
    children: [T],
    parent: T
}
```

This declaration means: any type that implements `TreeNode` must have an edge
named `children`, of type `[T]`, and an edge named `parent` of type `T`. Pretty
straightforward, just like a TypeScript interface.

Now, let's go on and define some types that _implement_ this interface, or in
other words, have at least these edges. For example,

```graphql
interface AVLTreeNode implements TreeNode {
    children: [T],
    parent: T
    skew: Integer
}

interface RedBlackTreeNode implements TreeNode {
    children: [T],
    parent: T
    color: Color
}
```

The reason this is useful is that sometimes we just want to query _all_ the trees
in our data for their parents and children. Instead of manually selecting every tree
type in our query, we just select for anything implementing `TreeNode`.

You can think of coercion like _reversing_ an interface implementation. Given some
data that you know implements an interface, you try to get back the original,
concrete type. For example, we could try to coerce a `TreeNode` into an `AVLTreeNode`.
If the coercion succeeds, and the underlying vertex really is an `AVLTreeNode`,
the query progresses, otherwise it halts. In practice, this could happen if
we have some edge that returns `[TreeNode]`, but we only want to look at
`AVLTreeNode`.

With all this coercion business in mind, this is the last method to implement:

```rust
fn resolve_coercion<V: AsVertex<Self::Vertex> + 'vertex>(
    &self,
    contexts: ContextIterator<'vertex, V>,
    type_name: &str,
    coerce_to_type: &str,
) -> ContextOutcomeIterator<'vertex, V, bool>;
```

Here, Trustfall is asking, "can `type_name` be coerved to `coerce_to_type`?". If
the previous part made sense, you may have realized that all this information is
actually already in the schema!. Thus this method can be implemented easily
using the
[`resolve_coercion_using_schema`](https://docs.rs/trustfall/latest/trustfall/provider/fn.resolve_coercion_using_schema.html)
helper, which completely obviates the need to manually implement this method!

```rust
fn resolve_coercion<V: AsVertex<Self::Vertex> + 'vertex>(
    &self,
    contexts: ContextIterator<'vertex, V>,
    type_name: &str,
    coerce_to_type: &str,
) -> ContextOutcomeIterator<'vertex, V, bool> {
    resolve_coercion_using_shchema(contexts, &schema, coerce_to_type)
}
```
will suffice :)

# Conclusion

I hope this article helped you understand Trustfall's data model and what . I'll have a 
separate post walking you through implementing an example adapter, since that's
a little different.

If you were intrigued by this content, here are some relevant links:
* [Trustfall](https://github.com/obi1kenobi/trustfall)
* [`cargo-semver-checks`](https://github.com/obi1kenobi/cargo-semver-checks)
* [`trustfall-rustdoc-adapter`](https://github.com/obi1kenobi/trustfall-rustdoc-adapter)

Until next time!

[^1] The types in a Rust program (and probably most other languages') form a graph
where the edge relationship is precisely the same as Trustfall's. If type `A` contains
a field of type `B`, there is an edge from `A` to `B`. If you can serialize all your
types into the Trustfall data model, you're good to go.

[^2] What do I mean by powerful? Hand-rolling Adapter gives you the opportunity
to implement optimizations that Trustfall can't natively do.
