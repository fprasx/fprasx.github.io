// Derived from:
// https://github.com/getzola/zola/issues/1070#issuecomment-1166637092

// The DOMContentLoaded event fires when the initial HTML
// document has been completely loaded and parsed, without
// waiting for stylesheets, images, and subframes to finish loading.
document.addEventListener('DOMContentLoaded', (_event) => {
    // Zola automatically inserts these class names, but the build in links do
    // not work
    const references = document.getElementsByClassName('footnote-reference')

    // Number of elements with this class is doubled. First N are the footnote
    // indicators, last N are the actual footnotes
    const numNotes = references.length / 2;
    for (let i = 0; i < numNotes; i++) {
        let footnote = references[i];
        let target = references[i + numNotes]

        let footnote_id = `footnote-definition-${i + 1}`
        let target_id = `footnote-target-${i + 1}`

        // Have the footnote point to the target
        footnote.setAttribute('id', footnote_id)
        footnote.firstChild.setAttribute('href', `#${target_id}`)

        // Have the target point back up to the footnote
        target.setAttribute('id', target_id)
        const backReference = document.createElement('a')
        backReference.setAttribute('href', `#${footnote_id}`)
        backReference.textContent = '↩'
        // Insert at the end of the parent node so the arrow comes after the text
        target.parentNode.append(backReference)
    }
});
